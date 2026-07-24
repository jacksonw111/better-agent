// @vitest-environment jsdom
import {
	encodeClose,
	encodeData,
	PTY_FRAME_HEADER_LEN,
	PtyFrameType,
	peekType,
} from "@better-agent/api/pty/frame";
import { act, cleanup, render } from "@testing-library/react";
import { Profiler } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const SESSION_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const COMPUTER_ID = "computer-1";

// Registries the mocked xterm Terminal + WebSocket push their instances into so
// a test can reach in and drive the byte path exactly like the server relay.
const h = vi.hoisted(() => {
	type Listener = ((event: unknown) => void) | null;
	const terminals: MockTerminal[] = [];
	const sockets: MockWebSocket[] = [];
	class MockTerminal {
		cols = 80;
		rows = 24;
		options: Record<string, unknown>;
		writes: Uint8Array[] = [];
		dataHandler: ((data: string) => void) | null = null;
		disposed = false;
		constructor(options: Record<string, unknown>) {
			this.options = options;
			terminals.push(this);
		}
		loadAddon() {
			return;
		}
		open() {
			return;
		}
		write(data: Uint8Array, cb?: () => void) {
			this.writes.push(data);
			cb?.();
		}
		onData(fn: (data: string) => void) {
			this.dataHandler = fn;
			return { dispose: () => (this.dataHandler = null) };
		}
		dispose() {
			this.disposed = true;
		}
	}
	class MockWebSocket {
		binaryType = "";
		onopen: Listener = null;
		onmessage: Listener = null;
		onclose: Listener = null;
		onerror: Listener = null;
		send = vi.fn();
		close = vi.fn();
		url: string;
		constructor(url: string) {
			this.url = url;
			sockets.push(this);
		}
	}
	return { terminals, sockets, MockTerminal, MockWebSocket };
});

vi.mock("@xterm/xterm/css/xterm.css", () => ({}));
vi.mock("@xterm/xterm", () => ({ Terminal: h.MockTerminal }));
vi.mock("@xterm/addon-fit", () => ({
	FitAddon: class {
		fit() {
			return;
		}
	},
}));
vi.mock("@xterm/addon-webgl", () => ({
	WebglAddon: class {
		onContextLoss() {
			return;
		}
		dispose() {
			return;
		}
	},
}));
vi.mock("@better-agent/env/web", () => ({
	env: { VITE_SERVER_URL: "http://localhost:3000" },
}));
vi.mock("@/utils/auth", () => ({ getAccessToken: () => "test-token" }));
vi.stubGlobal("WebSocket", h.MockWebSocket);

// Imported AFTER the mocks (vi.mock is hoisted, so this order is safe).
import { PtyTerminal } from "./pty-terminal";

const lastSocket = () => h.sockets.at(-1);
const lastTerminal = () => h.terminals.at(-1);
const messageEvent = (frame: Uint8Array) => ({
	data: frame.buffer.slice(0) as ArrayBuffer,
});
const sentFrames = (type: number) =>
	(lastSocket()?.send.mock.calls ?? [])
		.map((c) => c[0] as Uint8Array)
		.filter((f) => peekType(f) === type);

beforeEach(() => {
	h.terminals.length = 0;
	h.sockets.length = 0;
});
afterEach(() => {
	cleanup();
	vi.useRealTimers();
});

it("creates a 10k-scrollback terminal and opens the viewer socket with the token", () => {
	render(<PtyTerminal computerId={COMPUTER_ID} sessionId={SESSION_ID} />);
	expect(lastTerminal()?.options.scrollback).toBe(10_000);
	const url = lastSocket()?.url ?? "";
	expect(url).toContain("/pty/viewer-ws");
	expect(url).toContain(`computerId=${COMPUTER_ID}`);
	expect(url).toContain("access_token=test-token");
	expect(lastSocket()?.binaryType).toBe("arraybuffer");
});

it("sends an OPEN (attach) frame once the socket connects", () => {
	render(<PtyTerminal computerId={COMPUTER_ID} sessionId={SESSION_ID} />);
	act(() => lastSocket()?.onopen?.(new Event("open")));
	expect(sentFrames(PtyFrameType.OPEN)).toHaveLength(1);
});

it("streams DATA frames to term.write WITHOUT re-rendering React (hot path)", () => {
	let commits = 0;
	render(
		<Profiler id="pty" onRender={() => (commits += 1)}>
			<PtyTerminal computerId={COMPUTER_ID} sessionId={SESSION_ID} />
		</Profiler>
	);
	const socket = lastSocket();
	const term = lastTerminal();
	act(() => socket?.onopen?.(new Event("open"))); // lifecycle commit (allowed)
	const baseline = commits;
	const chunk = encodeData(SESSION_ID, new Uint8Array(1024).fill(65));
	const FLOOD = 2000;
	for (let i = 0; i < FLOOD; i += 1) {
		socket?.onmessage?.(messageEvent(chunk));
	}
	expect(term?.writes).toHaveLength(FLOOD); // every byte reached the terminal…
	expect(commits).toBe(baseline); // …and NOT ONE frame caused a React commit
});

it("forwards keystrokes as DATA frames on the socket", () => {
	render(<PtyTerminal computerId={COMPUTER_ID} sessionId={SESSION_ID} />);
	act(() => lastSocket()?.onopen?.(new Event("open")));
	lastTerminal()?.dataHandler?.("echo hi\r");
	const frames = sentFrames(PtyFrameType.DATA);
	expect(frames).toHaveLength(1);
	expect(
		new TextDecoder().decode(frames[0].subarray(PTY_FRAME_HEADER_LEN))
	).toBe("echo hi\r");
});

it("shows the exit code and stops reconnecting on a CLOSE frame", () => {
	vi.useFakeTimers();
	const { getByRole } = render(
		<PtyTerminal computerId={COMPUTER_ID} sessionId={SESSION_ID} />
	);
	const socket = lastSocket();
	act(() => socket?.onopen?.(new Event("open")));
	act(() => socket?.onmessage?.(messageEvent(encodeClose(SESSION_ID, 42))));
	expect(getByRole("status").textContent).toContain("exited");
	expect(getByRole("status").textContent).toContain("code 42");
	const before = h.sockets.length;
	act(() => socket?.onclose?.(new CloseEvent("close")));
	act(() => vi.advanceTimersByTime(10_000));
	expect(h.sockets.length).toBe(before); // an exited session never reconnects
});

it("reconnects with backoff after an unexpected socket close", () => {
	vi.useFakeTimers();
	render(<PtyTerminal computerId={COMPUTER_ID} sessionId={SESSION_ID} />);
	const socket = lastSocket();
	act(() => socket?.onopen?.(new Event("open")));
	const before = h.sockets.length;
	act(() => socket?.onclose?.(new CloseEvent("close")));
	expect(h.sockets.length).toBe(before); // waiting on backoff
	act(() => vi.advanceTimersByTime(250));
	expect(h.sockets.length).toBe(before + 1); // reconnected
});

it("does not connect at all while inactive (multi-session budget)", () => {
	render(
		<PtyTerminal
			active={false}
			computerId={COMPUTER_ID}
			sessionId={SESSION_ID}
		/>
	);
	expect(h.sockets).toHaveLength(0);
	expect(h.terminals).toHaveLength(0);
});

it("tears down the terminal and socket on unmount", () => {
	const { unmount } = render(
		<PtyTerminal computerId={COMPUTER_ID} sessionId={SESSION_ID} />
	);
	const socket = lastSocket();
	const term = lastTerminal();
	unmount();
	expect(term?.disposed).toBe(true);
	expect(socket?.close).toHaveBeenCalled();
});
