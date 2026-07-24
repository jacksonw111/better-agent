// P2-2 (DP-PTY6): the framework-free core of the web PTY terminal. This is the
// HOT PATH, and it is deliberately NOT React: inbound PTY bytes are decoded and
// handed straight to `term.write()`, and the byte counters live in plain
// closures here — a DATA frame arriving NEVER touches React state, which is the
// single invariant the whole "native-grade performance" claim rests on. The
// React component (pty-terminal.tsx) only constructs the real xterm `Terminal`
// + `WebSocket` and hands them to this driver; everything below runs outside
// the render/reconcile loop.
//
// It also owns the end-to-end flow-control cursor (DP-PTY4): xterm's `write`
// callback fires once a chunk has been parsed/consumed, so we accumulate
// consumed bytes and periodically send an ACK frame carrying the CUMULATIVE
// count. The CLI computes in-flight = produced − acked and backpressures its
// pty when that exceeds HIGH_WATER (1MB), so ACKing well under that keeps the
// producer flowing without ever letting an unbounded buffer form in the tab.

import {
	encodeAck,
	encodeData,
	encodeOpen,
	encodeResize,
	PtyFrameType,
} from "@better-agent/api/pty/frame";
import { decodeFrame } from "@better-agent/api/pty/frame-decode";

/** The slice of xterm's `Terminal` the driver touches — narrowed so tests can
 * drive it with a trivial fake and so nothing here reaches into React. */
export interface PtyTermLike {
	onData(handler: (data: string) => void): { dispose(): void };
	write(data: Uint8Array, callback?: () => void): void;
}

/** The slice of a `WebSocket` the driver sends frames on. */
export interface PtySocketLike {
	send(frame: Uint8Array): void;
}

export interface PtyDriverTimers {
	clearTimeout(handle: ReturnType<typeof setTimeout>): void;
	setTimeout(handler: () => void, ms: number): ReturnType<typeof setTimeout>;
}

export interface PtyDriverConfig {
	/** Flush a trailing ACK this many ms after the last consumed chunk, so an
	 * idle stream still drains the CLI's in-flight count to zero. */
	ackFlushMs?: number;
	/** Send an ACK once this many consumed bytes have accrued since the last
	 * one. Kept well under the CLI's 1MB HIGH_WATER so the producer never stalls
	 * on us; defaults to 256KB (the CLI's LOW_WATER). */
	ackThresholdBytes?: number;
	onExit?: (exitCode: number) => void;
	onState?: (state: string) => void;
	sessionId: string;
	socket: PtySocketLike;
	term: PtyTermLike;
	timers?: PtyDriverTimers;
}

const DEFAULT_ACK_THRESHOLD_BYTES = 256 * 1024;
const DEFAULT_ACK_FLUSH_MS = 50;

const defaultTimers: PtyDriverTimers = {
	setTimeout: (handler, ms) => setTimeout(handler, ms),
	clearTimeout: (handle) => clearTimeout(handle),
};

export interface PtyTerminalDriver {
	/** Tear down input wiring + timers. Does NOT dispose the terminal itself. */
	dispose(): void;
	/** Route one inbound binary frame (DATA → write, CLOSE → onExit, …). */
	handleFrame(frame: Uint8Array): void;
	/** (Re)subscribe/attach: sent on every socket (re)connect. The CLI replays
	 * scrollback from our last ACK cursor, so a reconnect resumes with no gap. */
	open(cols: number, rows: number): void;
	/** Report a new terminal size to the CLI (fit addon → SIGWINCH). */
	resize(rows: number, cols: number): void;
}

interface AckCursor {
	/** Cumulative consumed bytes advanced by `byteLength`; sends an ACK when the
	 * threshold is crossed, else arms the trailing-flush timer. */
	consume(byteLength: number): void;
	dispose(): void;
	/** Drop un-ACKed progress back to the last ACKed offset (reconnect replay). */
	rewind(): void;
}

/** The flow-control cursor (DP-PTY4): tracks bytes xterm has parsed and emits
 * cumulative ACK frames so the CLI can compute in-flight and backpressure its
 * pty. Plain closure state — never React. */
function createAckCursor(
	sessionId: string,
	socket: PtySocketLike,
	threshold: number,
	flushMs: number,
	timers: PtyDriverTimers
): AckCursor {
	let consumed = 0;
	let lastAcked = 0;
	let flushHandle: ReturnType<typeof setTimeout> | null = null;

	const clearFlush = (): void => {
		if (flushHandle !== null) {
			timers.clearTimeout(flushHandle);
			flushHandle = null;
		}
	};
	const sendAck = (): void => {
		clearFlush();
		if (consumed > lastAcked) {
			lastAcked = consumed;
			socket.send(encodeAck(sessionId, consumed));
		}
	};
	return {
		consume: (byteLength) => {
			consumed += byteLength;
			if (consumed - lastAcked >= threshold) {
				sendAck();
			} else if (flushHandle === null) {
				flushHandle = timers.setTimeout(() => {
					flushHandle = null;
					sendAck();
				}, flushMs);
			}
		},
		rewind: () => {
			consumed = lastAcked;
			clearFlush();
		},
		dispose: clearFlush,
	};
}

interface FrameSink {
	cursor: AckCursor;
	onExit?: (exitCode: number) => void;
	onState?: (state: string) => void;
	sessionId: string;
	term: PtyTermLike;
}

/** Routes one inbound frame. DATA is the hot path: bytes go straight to the
 * terminal and the write callback advances the flow-control cursor once xterm
 * has parsed (consumed) the chunk. RESIZE/OPEN/ACK never travel CLI→viewer. */
function dispatchFrame(frame: Uint8Array, sink: FrameSink): void {
	const decoded = decodeFrame(frame);
	if (!decoded || decoded.sessionId !== sink.sessionId) {
		return;
	}
	if (decoded.type === PtyFrameType.DATA) {
		const byteLength = decoded.data.byteLength;
		sink.term.write(decoded.data, () => sink.cursor.consume(byteLength));
	} else if (decoded.type === PtyFrameType.CLOSE) {
		sink.onExit?.(decoded.exitCode);
	} else if (decoded.type === PtyFrameType.STATE) {
		sink.onState?.(decoded.state);
	}
}

/**
 * Wires a PTY terminal's byte transport. Attaches `term.onData` immediately so
 * keystrokes flow out as DATA frames; the caller drives inbound frames through
 * `handleFrame` and connection lifecycle through `open`/`resize`.
 */
export function createPtyTerminalDriver(
	config: PtyDriverConfig
): PtyTerminalDriver {
	const {
		sessionId,
		socket,
		term,
		onExit,
		onState,
		ackThresholdBytes = DEFAULT_ACK_THRESHOLD_BYTES,
		ackFlushMs = DEFAULT_ACK_FLUSH_MS,
		timers = defaultTimers,
	} = config;
	const encoder = new TextEncoder();
	const cursor = createAckCursor(
		sessionId,
		socket,
		ackThresholdBytes,
		ackFlushMs,
		timers
	);
	const sink: FrameSink = { cursor, onExit, onState, sessionId, term };

	const input = term.onData((data) => {
		if (data.length > 0) {
			socket.send(encodeData(sessionId, encoder.encode(data)));
		}
	});

	return {
		handleFrame: (frame) => dispatchFrame(frame, sink),
		open: (cols, rows) => {
			// On a reconnect the CLI replays from the last absolute offset we ACKed
			// (its scrollback ring is addressed by that cursor), so rewind any
			// un-ACKed progress and let those bytes be re-counted as they arrive
			// again — no gap, at most one ACK window of duplicated display.
			cursor.rewind();
			socket.send(encodeOpen(sessionId, cols, rows, null));
		},
		resize: (rows, cols) => {
			socket.send(encodeResize(sessionId, rows, cols));
		},
		dispose: () => {
			cursor.dispose();
			input.dispose();
		},
	};
}
