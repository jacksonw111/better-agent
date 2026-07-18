import {
	generateComputerKeyPair,
	verifyComputerRequest,
} from "@better-agent/agent/crypto/computer-signature";
import type { RunLaunchCommand } from "@better-agent/agent/task-ports";
import { describe, expect, it, vi } from "vitest";
import { createMonotonicTimestamp } from "../computer-transport";
import type { WsEventMap, WsLike } from "../ws-duplex-socket";
import { runControlChannel } from "./control-ws";

// S25-T1 (design D4): the client half of /computer-ws — a signed-query
// handshake (same Ed25519 scheme as the x-ba-* header plane), launch frames
// parsed and handed to the single launch processor, and an exponential-
// backoff reconnect loop. The channel is best-effort by design: heartbeat
// pendingCommands remains the delivery guarantee, so a drop just means
// reconnect-and-keep-listening, never a crash.

const keyPair = generateComputerKeyPair();
const identity = {
	computerId: "computer-7",
	privateKeyPem: keyPair.privateKeyPem,
};

function launchFrame(runId: string): RunLaunchCommand {
	return {
		agentKind: "claude-code",
		description: "d",
		issueSnapshots: [],
		kind: "launch",
		repositoryUrl: null,
		runId,
		sessionCredential: "bt_x",
		taskId: "task-1",
		workspace: { kind: "standalone" },
	};
}

class FakeControlSocket implements WsLike {
	closed = false;
	readonly url: string;
	private readonly listeners: { [E in keyof WsEventMap]: WsEventMap[E][] } = {
		close: [],
		error: [],
		message: [],
		open: [],
	};

	constructor(url: string) {
		this.url = url;
	}

	on<E extends keyof WsEventMap>(event: E, listener: WsEventMap[E]): void {
		this.listeners[event].push(listener);
	}

	send(): void {
		// The control channel never sends — acks travel over oRPC.
	}

	close(): void {
		this.closed = true;
		this.emitClose();
	}

	emitOpen(): void {
		for (const listener of this.listeners.open) {
			listener();
		}
	}

	emitMessage(data: string): void {
		for (const listener of this.listeners.message) {
			listener(data);
		}
	}

	emitClose(): void {
		for (const listener of this.listeners.close) {
			listener(1006, "closed");
		}
	}
}

function fakeSleep() {
	const calls: number[] = [];
	const resolvers: (() => void)[] = [];
	return {
		calls,
		release: () => {
			resolvers.shift()?.();
		},
		sleep: (ms: number) => {
			calls.push(ms);
			return new Promise<void>((resolve) => {
				resolvers.push(resolve);
			});
		},
	};
}

function rig() {
	const sockets: FakeControlSocket[] = [];
	const sleeper = fakeSleep();
	const controller = new AbortController();
	const onLaunch = vi.fn();
	const onCloneProject = vi.fn();
	const onProjectQuery = vi.fn();
	const channel = runControlChannel({
		identity,
		nextTimestamp: createMonotonicTimestamp(),
		onCloneProject,
		onLaunch,
		onProjectQuery,
		serverUrl: "https://server.example",
		signal: controller.signal,
		sleep: sleeper.sleep,
		wsFactory: (url) => {
			const socket = new FakeControlSocket(url);
			sockets.push(socket);
			return socket;
		},
	});
	const socketCount = () => sockets.length;
	const waitForSocket = (count: number) =>
		vi.waitFor(() => {
			expect(socketCount()).toBeGreaterThanOrEqual(count);
		});
	return {
		channel,
		controller,
		onCloneProject,
		onLaunch,
		onProjectQuery,
		sleeper,
		sockets,
		waitForSocket,
	};
}

describe("control channel - handshake", () => {
	it("connects to /computer-ws with a verifiable signed query", async () => {
		const context = rig();
		await context.waitForSocket(1);
		const socket = context.sockets[0];
		const url = new URL(socket?.url ?? "");
		expect(url.protocol).toBe("wss:");
		expect(url.pathname).toBe("/computer-ws");
		expect(url.searchParams.get("computerId")).toBe("computer-7");
		const ts = Number(url.searchParams.get("ts"));
		expect(
			verifyComputerRequest(
				keyPair.publicKeyPem,
				"computer-7",
				ts,
				url.searchParams.get("sig") ?? ""
			)
		).toBe(true);
		context.controller.abort();
		await context.channel;
	});
});

describe("control channel - launch delivery", () => {
	it("parses launch frames and hands them to the processor", async () => {
		const context = rig();
		await context.waitForSocket(1);
		context.sockets[0]?.emitOpen();
		context.sockets[0]?.emitMessage(JSON.stringify(launchFrame("run-1")));
		expect(context.onLaunch).toHaveBeenCalledExactlyOnceWith(
			expect.objectContaining({ kind: "launch", runId: "run-1" })
		);
		context.controller.abort();
		await context.channel;
	});

	it("ignores unknown, incomplete and unparseable frames", async () => {
		const context = rig();
		await context.waitForSocket(1);
		context.sockets[0]?.emitOpen();
		context.sockets[0]?.emitMessage("not json {");
		context.sockets[0]?.emitMessage(JSON.stringify({ kind: "ping" }));
		context.sockets[0]?.emitMessage(JSON.stringify({ kind: "launch" }));
		context.sockets[0]?.emitMessage(JSON.stringify({ kind: "clone_project" }));
		context.sockets[0]?.emitMessage(
			JSON.stringify({ kind: "project_query", op: "rm_rf", requestId: "r" })
		);
		expect(context.onLaunch).not.toHaveBeenCalled();
		expect(context.onCloneProject).not.toHaveBeenCalled();
		expect(context.onProjectQuery).not.toHaveBeenCalled();
		context.controller.abort();
		await context.channel;
	});
});

describe("control channel - Q2 frame routing", () => {
	it("routes clone_project and project_query frames to their handlers", async () => {
		const context = rig();
		await context.waitForSocket(1);
		context.sockets[0]?.emitOpen();
		const clone = {
			kind: "clone_project",
			projectId: "project-1",
			repoCloneUrl: "https://github.com/acme/app.git",
		};
		const query = {
			kind: "project_query",
			op: "fs_list",
			path: "src",
			projectId: "project-1",
			requestId: "req-1",
		};
		context.sockets[0]?.emitMessage(JSON.stringify(clone));
		context.sockets[0]?.emitMessage(JSON.stringify(query));
		expect(context.onCloneProject).toHaveBeenCalledExactlyOnceWith(clone);
		expect(context.onProjectQuery).toHaveBeenCalledExactlyOnceWith(query);
		expect(context.onLaunch).not.toHaveBeenCalled();
		context.controller.abort();
		await context.channel;
	});
});

describe("control channel - reconnect", () => {
	it("reconnects after a drop with backoff and a fresh, larger timestamp", async () => {
		const context = rig();
		await context.waitForSocket(1);
		context.sockets[0]?.emitOpen();
		context.sockets[0]?.emitClose();
		await vi.waitFor(() => {
			expect(context.sleeper.calls).toEqual([1000]);
		});
		context.sleeper.release();
		await context.waitForSocket(2);
		const first = Number(
			new URL(context.sockets[0]?.url ?? "").searchParams.get("ts")
		);
		const second = Number(
			new URL(context.sockets[1]?.url ?? "").searchParams.get("ts")
		);
		expect(second).toBeGreaterThan(first);
		context.controller.abort();
		await context.channel;
	});

	it("backs off exponentially while the handshake keeps failing", async () => {
		const context = rig();
		await context.waitForSocket(1);
		context.sockets[0]?.emitClose();
		await vi.waitFor(() => {
			expect(context.sleeper.calls).toEqual([1000]);
		});
		context.sleeper.release();
		await context.waitForSocket(2);
		context.sockets[1]?.emitClose();
		await vi.waitFor(() => {
			expect(context.sleeper.calls).toEqual([1000, 2000]);
		});
		context.controller.abort();
		context.sleeper.release();
		await context.channel;
	});
});

describe("control channel - shutdown", () => {
	it("closes the live socket and stops reconnecting once aborted", async () => {
		const context = rig();
		await context.waitForSocket(1);
		context.sockets[0]?.emitOpen();
		context.controller.abort();
		await context.channel;
		expect(context.sockets[0]?.closed).toBe(true);
		expect(context.sockets).toHaveLength(1);
	});
});
