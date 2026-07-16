import { signComputerRequest } from "@better-agent/agent/crypto/computer-signature";
import type { RunLaunchCommand } from "@better-agent/agent/task-ports";
import type { ComputerSigningIdentity } from "../computer-transport";
import { createMonotonicTimestamp } from "../computer-transport";
import { isRecord } from "../normalize/types";
import { reconnectDelayMs } from "../ws-duplex-backoff";
import {
	defaultWsFactory,
	type WsFactory,
	type WsLike,
} from "../ws-duplex-socket";

// S25-T1 (design D4): the client half of the computer control channel — a
// `GET /computer-ws` connection authenticated by the SAME Ed25519 scheme as
// the x-ba-* header plane, carried in query params (a WS upgrade can't set
// custom headers; see apps/server/src/computer-ws.ts). The server pushes one
// JSON Launch Command per frame; the ack travels over oRPC (runs.ackLaunch),
// never this socket. The channel is best-effort BY DESIGN: heartbeat
// `pendingCommands` is the delivery guarantee, so this loop just reconnects
// with the shared exponential backoff schedule forever — a downed channel
// degrades to ≤10s launch latency, never to a crash.

const TRAILING_SLASH = /\/$/;
// http(s):// → ws(s):// — same one-step replace as relay-transport.ts.
const HTTP_SCHEME_PREFIX = /^http/;

export interface ControlChannelConfig {
	identity: ComputerSigningIdentity;
	log?: (message: string) => void;
	/** Strictly-increasing timestamp source. Share ONE with the HTTP
	 * transport (see index.ts) so the server's per-computer replay guard —
	 * which spans both planes — never sees the two racing backwards. */
	nextTimestamp?: () => number;
	onLaunch(command: RunLaunchCommand): void;
	serverUrl: string;
	signal: AbortSignal;
	sleep?: (ms: number) => Promise<void>;
	wsFactory?: WsFactory;
}

function defaultSleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/** The signed handshake URL — a FRESH timestamp + signature per attempt,
 * because the replay guard rejects any non-advancing timestamp. */
function controlWsUrl(
	config: ControlChannelConfig,
	nextTimestamp: () => number
): string {
	const base = config.serverUrl
		.replace(TRAILING_SLASH, "")
		.replace(HTTP_SCHEME_PREFIX, "ws");
	const timestampMs = nextTimestamp();
	const query = new URLSearchParams({
		computerId: config.identity.computerId,
		sig: signComputerRequest(
			config.identity.privateKeyPem,
			config.identity.computerId,
			timestampMs
		),
		ts: String(timestampMs),
	});
	return `${base}/computer-ws?${query.toString()}`;
}

/** Parses one pushed frame into a Launch Command, or null for anything else
 * (the channel ignores unknown frames instead of dying on them). */
export function parseLaunchFrame(data: unknown): RunLaunchCommand | null {
	let parsed: unknown;
	try {
		parsed = JSON.parse(String(data));
	} catch {
		return null;
	}
	if (
		isRecord(parsed) &&
		parsed.kind === "launch" &&
		typeof parsed.runId === "string" &&
		typeof parsed.taskId === "string" &&
		typeof parsed.sessionCredential === "string"
	) {
		return parsed as unknown as RunLaunchCommand;
	}
	return null;
}

/** One connection's lifetime: resolves `{ opened }` when the socket drops
 * (or the signal aborts), never rejects. */
function connectOnce(
	config: ControlChannelConfig,
	nextTimestamp: () => number,
	wsFactory: WsFactory
): Promise<{ opened: boolean }> {
	return new Promise((resolve) => {
		const socket: WsLike = wsFactory(controlWsUrl(config, nextTimestamp), {});
		let opened = false;
		let settled = false;
		const finish = () => {
			if (settled) {
				return;
			}
			settled = true;
			config.signal.removeEventListener("abort", onAbort);
			resolve({ opened });
		};
		const onAbort = () => {
			socket.close();
			finish();
		};
		socket.on("open", () => {
			opened = true;
		});
		socket.on("message", (data) => {
			const command = parseLaunchFrame(data);
			if (command) {
				config.onLaunch(command);
			}
		});
		socket.on("close", finish);
		socket.on("error", finish);
		config.signal.addEventListener("abort", onAbort, { once: true });
	});
}

/**
 * Runs the control channel until `signal` aborts: connect, listen for launch
 * frames, and on any drop wait the backoff delay (reset by a successful
 * open) before reconnecting with a fresh signed URL.
 */
export async function runControlChannel(
	config: ControlChannelConfig
): Promise<void> {
	const nextTimestamp = config.nextTimestamp ?? createMonotonicTimestamp();
	const wsFactory = config.wsFactory ?? defaultWsFactory;
	const sleep = config.sleep ?? defaultSleep;
	let failedAttempts = 0;
	while (!config.signal.aborted) {
		const { opened } = await connectOnce(config, nextTimestamp, wsFactory);
		if (config.signal.aborted) {
			return;
		}
		failedAttempts = opened ? 0 : failedAttempts + 1;
		config.log?.(
			`computer control channel down — reconnecting (attempt ${failedAttempts + 1})`
		);
		await sleep(reconnectDelayMs(opened ? 0 : failedAttempts - 1));
	}
}
