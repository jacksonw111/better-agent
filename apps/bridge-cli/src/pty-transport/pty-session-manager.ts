// The CLI daemon's PTY multiplexer core (Slice P2-1). Transport-agnostic: it
// consumes decoded inbound frames (from a web viewer, relayed by the server)
// and emits encoded outbound frames through `send` — the WS wiring lives in
// pty-ws-transport.ts. One instance owns every live pty session on this
// computer, keyed by sessionId.
//
// Per session it wires together the three phase-2 mechanisms:
//   • DP-PTY5 coalescing — pty output is batched into ~12ms DATA frames.
//   • DP-PTY3 scrollback — a bounded ring feeds reattach + reconnect resume.
//   • DP-PTY4 flow control — in-flight = produced − acked; pause the pty past
//     HIGH_WATER, resume under LOW_WATER, so a slow/absent viewer can't OOM us.

import { homedir } from "node:os";
import {
	encodeClose,
	encodeData,
	type PtyFrame,
	PtyFrameType,
	type PtyOpenSpec,
} from "@better-agent/api/pty/frame";
import type { PtyExit, PtyHandle } from "../pty/spawn-pty";
import { spawnPty } from "../pty/spawn-pty";
import { createFrameCoalescer, type FrameCoalescer } from "./frame-coalescer";
import {
	createScrollbackRing,
	DEFAULT_SCROLLBACK_BYTES,
	type ScrollbackRing,
} from "./scrollback-ring";

/** DP-PTY4 high-water: pause the pty once this many bytes are in flight. */
export const HIGH_WATER_BYTES = 1024 * 1024;
/** DP-PTY4 low-water: resume the pty once in-flight falls back under this. */
export const LOW_WATER_BYTES = 256 * 1024;

export type PtySpawnFn = (
	spec: PtyOpenSpec,
	cols: number,
	rows: number
) => PtyHandle;

export interface PtySessionManagerDeps {
	highWaterBytes?: number;
	lowWaterBytes?: number;
	/** Injectable so tests can flush coalescing synchronously. */
	makeCoalescer?: (onFlush: (merged: Uint8Array) => void) => FrameCoalescer;
	scrollbackBytes?: number;
	/** Sink for encoded outbound frames (DATA/CLOSE). */
	send: (frame: Uint8Array) => void;
	spawn?: PtySpawnFn;
}

export interface PtySessionManager {
	/** Kill every live session (daemon shutdown). */
	closeAll(): void;
	/** Route one decoded inbound frame from a viewer. */
	handleFrame(frame: PtyFrame): void;
	/** After the WS reconnects: replay each live session's scrollback from its
	 * last ACK cursor, so the viewer continues without a gap (DP-PTY3). */
	onReconnect(): void;
	/** Live session count (diagnostics/tests). */
	readonly sessionCount: number;
}

interface Session {
	acked: number;
	coalescer: FrameCoalescer;
	handle: PtyHandle;
	paused: boolean;
	ring: ScrollbackRing;
}

/** Resolved config + live session map, threaded through the module-level
 * handlers (keeps `createPtySessionManager` itself tiny). */
interface ManagerCtx {
	highWater: number;
	lowWater: number;
	makeCoalescer: (onFlush: (merged: Uint8Array) => void) => FrameCoalescer;
	scrollbackBytes: number;
	send: (frame: Uint8Array) => void;
	sessions: Map<string, Session>;
	spawn: PtySpawnFn;
}

// An empty `cwd` means "the computer's default" — a session started with no
// project (P2-3a's home-directory terminal) carries `cwd: ""`, which we resolve
// to the user's home so the pty-broker never spawns against a bad directory.
const defaultSpawn: PtySpawnFn = (spec, cols, rows) =>
	spawnPty(spec.command, spec.args, spec.cwd || homedir(), cols, rows);

function inFlight(session: Session): number {
	return session.ring.producedOffset - session.acked;
}

function applyBackpressure(ctx: ManagerCtx, session: Session): void {
	if (!session.paused && inFlight(session) > ctx.highWater) {
		session.paused = true;
		session.handle.pause();
	}
}

function releaseBackpressure(ctx: ManagerCtx, session: Session): void {
	if (session.paused && inFlight(session) < ctx.lowWater) {
		session.paused = false;
		session.handle.resume();
	}
}

function openSession(
	ctx: ManagerCtx,
	sessionId: string,
	spec: PtyOpenSpec,
	cols: number,
	rows: number
): void {
	const ring = createScrollbackRing(ctx.scrollbackBytes);
	const coalescer = ctx.makeCoalescer((merged) =>
		ctx.send(encodeData(sessionId, merged))
	);
	const session: Session = {
		acked: 0,
		coalescer,
		handle: ctx.spawn(spec, cols, rows),
		paused: false,
		ring,
	};
	ctx.sessions.set(sessionId, session);
	session.handle.onData((chunk) => {
		ring.append(chunk);
		applyBackpressure(ctx, session);
		coalescer.push(chunk);
	});
	session.handle.onExit((exit: PtyExit) => {
		coalescer.flush();
		coalescer.dispose();
		ctx.send(encodeClose(sessionId, exit.code ?? -1));
		ctx.sessions.delete(sessionId);
	});
}

// DP-PTY3 reattach: a viewer sending OPEN for an existing session gets its
// scrollback replayed as one bulk DATA burst before live output resumes.
function handleOpen(
	ctx: ManagerCtx,
	sessionId: string,
	cols: number,
	rows: number,
	spec: PtyOpenSpec | null
): void {
	const existing = ctx.sessions.get(sessionId);
	if (existing) {
		existing.handle.resize(cols, rows);
		const backlog = existing.ring.bytesFrom(0);
		if (backlog.length > 0) {
			ctx.send(encodeData(sessionId, backlog));
		}
		return;
	}
	if (spec) {
		openSession(ctx, sessionId, spec, cols, rows);
	}
}

function handleAck(ctx: ManagerCtx, sessionId: string, consumed: number): void {
	const session = ctx.sessions.get(sessionId);
	if (!session) {
		return;
	}
	session.acked = Math.max(session.acked, consumed);
	releaseBackpressure(ctx, session);
}

function handleFrame(ctx: ManagerCtx, frame: PtyFrame): void {
	switch (frame.type) {
		case PtyFrameType.OPEN:
			handleOpen(ctx, frame.sessionId, frame.cols, frame.rows, frame.spec);
			return;
		case PtyFrameType.DATA:
			ctx.sessions.get(frame.sessionId)?.handle.write(Buffer.from(frame.data));
			return;
		case PtyFrameType.RESIZE:
			ctx.sessions.get(frame.sessionId)?.handle.resize(frame.cols, frame.rows);
			return;
		case PtyFrameType.ACK:
			handleAck(ctx, frame.sessionId, frame.consumedBytes);
			return;
		case PtyFrameType.CLOSE:
			ctx.sessions.get(frame.sessionId)?.handle.kill();
			return;
		default:
			return;
	}
}

export function createPtySessionManager(
	deps: PtySessionManagerDeps
): PtySessionManager {
	const ctx: ManagerCtx = {
		highWater: deps.highWaterBytes ?? HIGH_WATER_BYTES,
		lowWater: deps.lowWaterBytes ?? LOW_WATER_BYTES,
		makeCoalescer:
			deps.makeCoalescer ?? ((onFlush) => createFrameCoalescer({ onFlush })),
		scrollbackBytes: deps.scrollbackBytes ?? DEFAULT_SCROLLBACK_BYTES,
		send: deps.send,
		sessions: new Map<string, Session>(),
		spawn: deps.spawn ?? defaultSpawn,
	};
	return {
		get sessionCount() {
			return ctx.sessions.size;
		},
		handleFrame: (frame) => handleFrame(ctx, frame),
		onReconnect() {
			for (const [sessionId, session] of ctx.sessions) {
				const backlog = session.ring.bytesFrom(session.acked);
				if (backlog.length > 0) {
					ctx.send(encodeData(sessionId, backlog));
				}
			}
		},
		closeAll() {
			for (const session of ctx.sessions.values()) {
				session.coalescer.dispose();
				session.handle.kill();
			}
			ctx.sessions.clear();
		},
	};
}
