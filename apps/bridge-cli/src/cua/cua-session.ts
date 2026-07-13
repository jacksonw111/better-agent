/**
 * Orchestrates the local CUA video plane for one bridge session, wiring the
 * pure/injectable modules to real OS resources:
 *   ensureCuaEnvironment (lume auto-provision) → lume.run(vm) → wait for the
 *   VM's VNC → startVncRelay (server WS ⇄ VM VNC TCP).
 *
 * `startCuaSession` returns a handle whose `stop()` tears the relay down and
 * stops the VM, so ending the agent session leaves nothing running. All the
 * hard logic lives in the unit-tested modules; this file is the thin,
 * side-effectful glue (spawn/net/ws), kept deliberately small.
 */

import { spawn } from "node:child_process";
import { connect as tcpConnect } from "node:net";
import WebSocket from "ws";
import {
	type ExecResult,
	ensureCuaEnvironment,
	type LumeBootstrapDeps,
} from "./lume-bootstrap";
import { createLumeClient, type LumeClient } from "./lume-client";
import {
	type RelaySocket,
	startVncRelay,
	type VncRelayDeps,
} from "./vnc-relay";

const VM_VNC_POLL_INTERVAL_MS = 1000;
const VM_VNC_POLL_ATTEMPTS = 120;

export interface CuaSessionOptions {
	log?: (message: string) => void;
	/** Reports the live VNC endpoint (or null to clear) so the web mounts the
	 * viewer. No-op if omitted. */
	reportVnc?: (vncEndpoint: string | null) => Promise<void>;
	serverUrl: string;
	sessionId: string;
	token: string;
	/** Relay this VNC directly (skip lume provisioning + boot) — the lume-free
	 * test path (`--cua-vnc-url`). */
	vncUrlOverride?: string;
}

export interface CuaSession {
	stop: () => Promise<void>;
}

const sleep = (ms: number): Promise<void> =>
	new Promise((resolve) => {
		setTimeout(resolve, ms);
	});

function execCapture(command: string, args: string[]): Promise<ExecResult> {
	return new Promise((resolve) => {
		const child = spawn(command, args);
		let stdout = "";
		let stderr = "";
		child.stdout?.on("data", (chunk) => {
			stdout += String(chunk);
		});
		child.stderr?.on("data", (chunk) => {
			stderr += String(chunk);
		});
		child.on("error", () =>
			resolve({ code: 127, stdout, stderr: "spawn error" })
		);
		child.on("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
	});
}

function spawnDetached(command: string, args: string[]): void {
	const child = spawn(command, args, { detached: true, stdio: "ignore" });
	child.unref();
}

function buildBootstrapDeps(
	lume: LumeClient,
	log: (m: string) => void
): LumeBootstrapDeps {
	return {
		platform: process.platform,
		arch: process.arch,
		exec: execCapture,
		spawnDetached,
		lume,
		log,
		sleep,
	};
}

function wsRelaySocket(
	url: string,
	headers: Record<string, string>
): RelaySocket {
	const ws = new WebSocket(url, { headers });
	ws.binaryType = "nodebuffer";
	const queue: (Uint8Array | string)[] = [];
	let open = false;
	ws.on("open", () => {
		open = true;
		for (const item of queue) {
			ws.send(item);
		}
		queue.length = 0;
	});
	return {
		send: (data) => (open ? ws.send(data) : queue.push(data)),
		close: () => ws.close(),
		onData: (cb) => ws.on("message", (data) => cb(data as Uint8Array)),
		onClose: (cb) => ws.on("close", () => cb()),
	};
}

function tcpRelaySocket(host: string, port: number): RelaySocket {
	const socket = tcpConnect(port, host);
	return {
		send: (data) => socket.write(data),
		close: () => socket.destroy(),
		onData: (cb) => socket.on("data", (chunk) => cb(chunk)),
		onClose: (cb) => socket.on("close", () => cb()),
	};
}

const relayDeps = (log: (m: string) => void): VncRelayDeps => ({
	connectWs: wsRelaySocket,
	connectTcp: tcpRelaySocket,
	log,
});

async function waitForVmVnc(lume: LumeClient, vmName: string): Promise<string> {
	for (let attempt = 0; attempt < VM_VNC_POLL_ATTEMPTS; attempt += 1) {
		const vm = await lume.get(vmName);
		if (vm?.vncUrl) {
			return vm.vncUrl;
		}
		await sleep(VM_VNC_POLL_INTERVAL_MS);
	}
	throw new Error("VM did not expose a VNC endpoint in time");
}

interface Provisioned {
	stopVm: () => Promise<void>;
	vncUrl: string;
}

/** Resolves the VNC to relay: the `--cua-vnc-url` override (skip lume entirely
 * — the test path) or a freshly provisioned + booted lume VM. `stopVm` tears
 * down whatever it created (a no-op for the override). */
async function provisionVnc(
	options: CuaSessionOptions,
	log: (m: string) => void
): Promise<Provisioned> {
	if (options.vncUrlOverride) {
		log(`relaying provided VNC (no lume): ${options.vncUrlOverride}`);
		return { vncUrl: options.vncUrlOverride, stopVm: () => Promise.resolve() };
	}
	const lume = createLumeClient();
	const { vmName } = await ensureCuaEnvironment(buildBootstrapDeps(lume, log));
	log(`starting VM "${vmName}"…`);
	await lume.run(vmName);
	const vncUrl = await waitForVmVnc(lume, vmName);
	return {
		vncUrl,
		stopVm: async () => {
			try {
				await lume.stop(vmName);
			} catch {
				// Best-effort teardown; a lume stop failure shouldn't surface.
			}
		},
	};
}

/** Provisions the VNC (lume VM or `--cua-vnc-url` override) and opens the VNC
 * relay for `sessionId`. Rejects (with a clear message) on any prerequisite/
 * boot failure; the caller logs it without killing the agent session. */
export async function startCuaSession(
	options: CuaSessionOptions
): Promise<CuaSession> {
	const log = options.log ?? (() => undefined);
	const { vncUrl, stopVm } = await provisionVnc(options, log);
	const relay = startVncRelay(
		{
			serverUrl: options.serverUrl,
			sessionId: options.sessionId,
			token: options.token,
			vncUrl,
		},
		relayDeps(log)
	);
	// Signal the web that this session now has a live desktop to watch.
	await options.reportVnc?.(vncUrl);
	let stopped = false;
	return {
		stop: async () => {
			if (stopped) {
				return;
			}
			stopped = true;
			relay.stop();
			await options.reportVnc?.(null).catch(() => undefined);
			await stopVm();
		},
	};
}
