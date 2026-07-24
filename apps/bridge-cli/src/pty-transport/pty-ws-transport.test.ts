import { generateComputerKeyPair } from "@better-agent/agent/crypto/computer-signature";
import {
	encodeAck,
	encodeOpen,
	type PtyFrame,
	PtyFrameType,
} from "@better-agent/api/pty/frame";
import { decodeFrame } from "@better-agent/api/pty/frame-decode";
import { describe, expect, it, vi } from "vitest";
import type { PtyHandle } from "../pty/spawn-pty";
import {
	type PtyWsLike,
	ptyAgentWsUrl,
	runPtyTransport,
} from "./pty-ws-transport";

const SID = "0f8fad5b-d9cb-469f-a165-70867728950e";
const SPEC = { command: "cat", args: [], cwd: "/tmp" };

function identity() {
	const { privateKeyPem } = generateComputerKeyPair();
	return { computerId: "computer-1", privateKeyPem };
}

class FakeSocket implements PtyWsLike {
	sent: Uint8Array[] = [];
	closed = false;
	private readonly listeners = new Map<
		string,
		((...args: unknown[]) => void)[]
	>();
	on(event: string, listener: (...args: unknown[]) => void): void {
		const list = this.listeners.get(event) ?? [];
		list.push(listener);
		this.listeners.set(event, list);
	}
	emit(event: string, ...args: unknown[]): void {
		for (const listener of this.listeners.get(event) ?? []) {
			listener(...args);
		}
	}
	send(data: Uint8Array): void {
		this.sent.push(data);
	}
	close(): void {
		this.closed = true;
		this.emit("close", 1000, "");
	}
	decoded(): PtyFrame[] {
		return this.sent
			.map((f) => decodeFrame(f))
			.filter((f): f is PtyFrame => f !== null);
	}
}

function createFakePty() {
	let dataCb: ((chunk: Uint8Array) => void) | null = null;
	const handle = {
		onData: (cb: (chunk: Uint8Array) => void) => {
			dataCb = cb;
		},
		onExit: vi.fn(),
		write: vi.fn(),
		resize: vi.fn(),
		pause: vi.fn(),
		resume: vi.fn(),
		kill: vi.fn(),
		pid: 1,
	} as unknown as PtyHandle;
	return { handle, emitData: (chunk: Uint8Array) => dataCb?.(chunk) };
}

const tick = () => new Promise((r) => setTimeout(r, 0));
const bytes = (str: string) => new TextEncoder().encode(str);

/** The n-th created socket, asserting it exists — keeps the tests free of
 * optional chaining (which would push them over the complexity gate). */
function socketAt(created: FakeSocket[], index: number): FakeSocket {
	const socket = created[index];
	if (!socket) {
		throw new Error(`no socket created at index ${index}`);
	}
	return socket;
}

describe("ptyAgentWsUrl", () => {
	it("targets /pty/agent-ws with a signed computerId/sig/ts query", () => {
		const url = ptyAgentWsUrl(
			{
				identity: identity(),
				serverUrl: "https://api.example.com/",
				signal: new AbortController().signal,
				wsFactory: () => new FakeSocket(),
			},
			() => 1234
		);
		expect(url).toContain("wss://api.example.com/pty/agent-ws?");
		const query = new URL(url).searchParams;
		expect(query.get("computerId")).toBe("computer-1");
		expect(query.get("ts")).toBe("1234");
		expect(query.get("sig")).toBeTruthy();
	});
});

describe("runPtyTransport — open & stream", () => {
	it("spawns on OPEN and streams pty output back as DATA frames", async () => {
		const controller = new AbortController();
		const created: FakeSocket[] = [];
		const fake = createFakePty();
		const spawn = vi.fn(() => fake.handle);
		const run = runPtyTransport({
			identity: identity(),
			serverUrl: "http://x",
			signal: controller.signal,
			spawn,
			sleep: () => {
				controller.abort();
				return Promise.resolve();
			},
			wsFactory: () => {
				const socket = new FakeSocket();
				created.push(socket);
				return socket;
			},
		});
		await tick();
		const socket = socketAt(created, 0);
		socket.emit("open");
		socket.emit("message", encodeOpen(SID, 80, 24, SPEC));
		await tick();
		expect(spawn).toHaveBeenCalledWith(SPEC, 80, 24);
		fake.emitData(bytes("hello"));
		await new Promise((r) => setTimeout(r, 30)); // let the coalescer flush
		socket.close();
		await run;
		const data = socket.decoded().find((f) => f.type === PtyFrameType.DATA);
		if (data?.type === PtyFrameType.DATA) {
			expect(new TextDecoder().decode(data.data)).toBe("hello");
		} else {
			throw new Error("expected pty output relayed as a DATA frame");
		}
	});
});

describe("runPtyTransport — reconnect resume", () => {
	it("replays scrollback from the ACK cursor on reconnect", async () => {
		const controller = new AbortController();
		const created: FakeSocket[] = [];
		const fake = createFakePty();
		const sleepResolvers: (() => void)[] = [];
		const run = runPtyTransport({
			identity: identity(),
			serverUrl: "http://x",
			signal: controller.signal,
			spawn: () => fake.handle,
			sleep: () => new Promise<void>((r) => sleepResolvers.push(r)),
			wsFactory: () => {
				const socket = new FakeSocket();
				created.push(socket);
				return socket;
			},
		});
		await tick();
		const first = socketAt(created, 0);
		first.emit("open");
		first.emit("message", encodeOpen(SID, 80, 24, SPEC));
		await tick();
		fake.emitData(bytes("aaaa"));
		first.emit("message", encodeAck(SID, 4)); // viewer consumed "aaaa"
		fake.emitData(bytes("bbbb"));
		first.close(); // drop → loop awaits sleep
		await tick();
		const releaseBackoff = sleepResolvers[0] ?? (() => undefined);
		releaseBackoff(); // let the backoff elapse → reconnect
		await tick();
		const second = socketAt(created, 1);
		second.emit("open"); // re-open → onReconnect replays from cursor
		await tick();
		const resume = second.decoded().find((f) => f.type === PtyFrameType.DATA);
		if (resume?.type === PtyFrameType.DATA) {
			expect(new TextDecoder().decode(resume.data)).toBe("bbbb");
		} else {
			throw new Error("expected a resume burst from the ack cursor");
		}
		controller.abort();
		second.close();
		for (const resolve of sleepResolvers) {
			resolve();
		}
		await run;
	});
});
