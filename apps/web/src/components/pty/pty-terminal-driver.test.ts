import {
	ACK_PAYLOAD_LEN,
	bytesToUuid,
	encodeClose,
	encodeData,
	encodeState,
	PTY_FRAME_HEADER_LEN,
	PtyFrameType,
	peekSessionId,
	peekType,
} from "@better-agent/api/pty/frame";
import { beforeEach, expect, it, vi } from "vitest";
import {
	createPtyTerminalDriver,
	type PtyTermLike,
} from "./pty-terminal-driver";

// Top-level `it`s (no `describe` wrapper): the repo caps any one function at 50
// lines, and a describe body enclosing every case blows that instantly.

const SESSION_ID = "11111111-2222-3333-4444-555555555555";
const OTHER_SESSION_ID = "99999999-8888-7777-6666-555555555555";

// A fake xterm whose `write` callback fires SYNCHRONOUSLY (real xterm defers it;
// firing it inline makes the flow-control assertions deterministic).
function makeTerm() {
	const writes: Uint8Array[] = [];
	let handler: ((data: string) => void) | null = null;
	let disposed = false;
	const term: PtyTermLike = {
		write: (data, callback) => {
			writes.push(data);
			callback?.();
		},
		onData: (fn) => {
			handler = fn;
			return {
				dispose: () => {
					disposed = true;
				},
			};
		},
	};
	return {
		term,
		writes,
		type: (data: string) => handler?.(data),
		isDisposed: () => disposed,
	};
}

function makeSocket() {
	const frames: Uint8Array[] = [];
	return { socket: { send: (f: Uint8Array) => frames.push(f) }, frames };
}

function makeDriver(overrides: Record<string, unknown> = {}) {
	const t = makeTerm();
	const s = makeSocket();
	const driver = createPtyTerminalDriver({
		sessionId: SESSION_ID,
		term: t.term,
		socket: s.socket,
		...overrides,
	});
	return { driver, t, s };
}

function ackConsumedBytes(frame: Uint8Array): number {
	const view = new DataView(
		frame.buffer,
		frame.byteOffset + PTY_FRAME_HEADER_LEN,
		ACK_PAYLOAD_LEN
	);
	return Number(view.getBigUint64(0));
}

beforeEach(() => {
	vi.useRealTimers();
});

it("writes DATA payload straight to the terminal (hot path)", () => {
	const { driver, t } = makeDriver();
	driver.handleFrame(
		encodeData(SESSION_ID, new TextEncoder().encode("hello pty"))
	);
	expect(t.writes).toHaveLength(1);
	expect(new TextDecoder().decode(t.writes[0])).toBe("hello pty");
});

it("ignores frames addressed to a different session", () => {
	const { driver, t } = makeDriver();
	driver.handleFrame(encodeData(OTHER_SESSION_ID, new Uint8Array([1, 2, 3])));
	expect(t.writes).toHaveLength(0);
});

it("emits a cumulative ACK once the consumed-byte threshold is crossed", () => {
	const { driver, s } = makeDriver({ ackThresholdBytes: 8 });
	driver.handleFrame(encodeData(SESSION_ID, new Uint8Array(5)));
	expect(s.frames).toHaveLength(0); // under threshold, no ACK yet
	driver.handleFrame(encodeData(SESSION_ID, new Uint8Array(5)));
	expect(s.frames).toHaveLength(1);
	expect(peekType(s.frames[0])).toBe(PtyFrameType.ACK);
	expect(peekSessionId(s.frames[0])).toBe(SESSION_ID);
	expect(ackConsumedBytes(s.frames[0])).toBe(10); // cumulative 5 + 5
});

it("flushes a trailing ACK for a sub-threshold stream after the debounce", () => {
	vi.useFakeTimers();
	const { driver, s } = makeDriver({ ackThresholdBytes: 1024, ackFlushMs: 50 });
	driver.handleFrame(encodeData(SESSION_ID, new Uint8Array(16)));
	expect(s.frames).toHaveLength(0);
	vi.advanceTimersByTime(50);
	expect(s.frames).toHaveLength(1);
	expect(ackConsumedBytes(s.frames[0])).toBe(16);
	driver.dispose();
});

it("sends an OPEN (attach) frame with cols/rows on open()", () => {
	const { driver, s } = makeDriver();
	driver.open(120, 40);
	expect(peekType(s.frames[0])).toBe(PtyFrameType.OPEN);
	const view = new DataView(
		s.frames[0].buffer,
		s.frames[0].byteOffset + PTY_FRAME_HEADER_LEN
	);
	expect(view.getUint16(0)).toBe(120); // cols
	expect(view.getUint16(2)).toBe(40); // rows
});

it("resends OPEN on a reconnect so the CLI replays from the ACK cursor", () => {
	const { driver, s } = makeDriver();
	driver.open(80, 24);
	driver.open(80, 24); // reconnect
	const opens = s.frames.filter((f) => peekType(f) === PtyFrameType.OPEN);
	expect(opens).toHaveLength(2);
});

it("sends a RESIZE frame with rows/cols on resize()", () => {
	const { driver, s } = makeDriver();
	driver.resize(30, 100);
	expect(peekType(s.frames[0])).toBe(PtyFrameType.RESIZE);
	const view = new DataView(
		s.frames[0].buffer,
		s.frames[0].byteOffset + PTY_FRAME_HEADER_LEN
	);
	expect(view.getUint16(0)).toBe(30); // rows
	expect(view.getUint16(2)).toBe(100); // cols
});

it("forwards keystrokes as DATA frames", () => {
	const { t, s } = makeDriver();
	t.type("ls\r");
	expect(peekType(s.frames[0])).toBe(PtyFrameType.DATA);
	expect(peekSessionId(s.frames[0])).toBe(SESSION_ID);
	expect(
		new TextDecoder().decode(s.frames[0].subarray(PTY_FRAME_HEADER_LEN))
	).toBe("ls\r");
});

it("invokes onExit with the CLOSE exit code", () => {
	const onExit = vi.fn();
	const { driver } = makeDriver({ onExit });
	driver.handleFrame(encodeClose(SESSION_ID, 137));
	expect(onExit).toHaveBeenCalledWith(137);
});

it("invokes onState with a STATE frame's payload", () => {
	const onState = vi.fn();
	const { driver } = makeDriver({ onState });
	driver.handleFrame(encodeState(SESSION_ID, "running"));
	expect(onState).toHaveBeenCalledWith("running");
});

it("dispose() tears down the input subscription and pending flush timer", () => {
	vi.useFakeTimers();
	const clearTimeoutSpy = vi.fn();
	const { driver, t } = makeDriver({
		ackThresholdBytes: 1024,
		timers: {
			setTimeout: (handler: () => void, ms: number) => setTimeout(handler, ms),
			clearTimeout: clearTimeoutSpy,
		},
	});
	driver.handleFrame(encodeData(SESSION_ID, new Uint8Array(8))); // schedules flush
	driver.dispose();
	expect(t.isDisposed()).toBe(true);
	expect(clearTimeoutSpy).toHaveBeenCalled();
});

it("round-trips: OPEN out, session id readable back off the wire", () => {
	const { driver, s } = makeDriver();
	driver.open(80, 24);
	expect(bytesToUuid(s.frames[0].subarray(1, PTY_FRAME_HEADER_LEN))).toBe(
		SESSION_ID
	);
});
