// R0-T2 (local-agent transport refactor): the CLI half of the WS duplex
// channel — the pinned counterpart to the server half merged in R0-T1
// (@better-agent/api/bridge/ws-session.ts). `connectDuplexChannel` is the
// only thing `relay-transport.ts` calls; everything else here (and in
// ws-duplex-frames.ts / ws-duplex-reconnect.ts / ws-duplex-backoff.ts, split
// out purely to stay under this file's line cap) is this module's own
// internals.
//
// Reconnect happens ENTIRELY inside the channel (ws-duplex-reconnect.ts):
// `run-bridge-session-duplex.ts` never sees a transient drop, only the
// (once-ever) `onDown` when reconnecting has given up for good.

import type { QueuedEvent } from "./forward-events";
import { attemptHandshake, bindSocket } from "./ws-duplex-reconnect";
import type { WsFactory, WsLike } from "./ws-duplex-socket";

/** What `run-bridge-session-duplex.ts` drives instead of `pollLoop` while the
 * WS channel is up — see the R0-T2 brief's pinned design. */
export interface DuplexChannel {
	/** Tears the channel down for good — a no-op if it's already down
	 * (`onDown` already fired) or already closed. */
	close(): void;
	/** Registers the (single) handler for every `command` frame, in the
	 * ascending order the server sends them. */
	onCommand(fn: (cmd: { id: number; data: unknown }) => void): void;
	/** Registers the (single) handler fired exactly once, when reconnecting
	 * has been given up on for good — see ws-duplex-reconnect.ts. */
	onDown(fn: (reason: string) => void): void;
	/** Resolves once the matching `events_ack` arrives (surviving any number
	 * of invisible reconnects in between); rejects if the channel goes down
	 * before that happens. Two calls in flight at once ack independently, in
	 * whichever order their acks arrive. */
	sendEvents(batch: QueuedEvent<unknown>[]): Promise<void>;
}

export interface OpenDuplexConfig {
	afterId: number;
	headers: Record<string, string>;
	sessionId: string;
	/** Overridable for tests — the reconnect backoff's timer. */
	sleep?: (ms: number) => Promise<void>;
	url: string;
	wsFactory: WsFactory;
}

/** One unacked `sendEvents` call — kept around so a reconnect can resend the
 * EXACT same frame (same `batchId`/`idempotencyKeys`, see
 * ws-duplex-reconnect.ts's `resendPending`) and so `fireDown` has something
 * to reject. */
export interface PendingBatch {
	batch: QueuedEvent<unknown>[];
	idempotencyKeys: string[];
	reject: (error: Error) => void;
	resolve: () => void;
}

/** Mutable state threaded through ws-duplex-frames.ts and
 * ws-duplex-reconnect.ts's helpers — bundled into one object (mirrors
 * ws-session.ts's server-side `Conn`) rather than closed over piecemeal, so
 * those modules can share it without every helper needing a long parameter
 * list. */
export interface ChannelState {
	closed: boolean;
	commandHandler: ((cmd: { id: number; data: unknown }) => void) | null;
	config: OpenDuplexConfig;
	downFired: boolean;
	downHandler: ((reason: string) => void) | null;
	/** The highest command id delivered to `commandHandler` so far — reused as
	 * `afterId` on every reconnect handshake, per the pinned design. */
	lastCommandId: number;
	nextBatchSeq: number;
	pending: Map<string, PendingBatch>;
	/** Guards against `reconnectLoop` being kicked off twice for the same drop
	 * (a real socket commonly fires both 'error' and 'close'). */
	reconnecting: boolean;
	socket: WsLike;
}

function sendEventsOnChannel(
	state: ChannelState,
	batch: QueuedEvent<unknown>[]
): Promise<void> {
	if (state.downFired) {
		return Promise.reject(new Error("bridge: ws channel is down"));
	}
	const batchId = `b${state.nextBatchSeq}`;
	state.nextBatchSeq += 1;
	const idempotencyKeys = batch.map((item) => item.idempotencyKey);
	return new Promise((resolve, reject) => {
		state.pending.set(batchId, { batch, idempotencyKeys, resolve, reject });
		state.socket.send(
			JSON.stringify({
				t: "events",
				batchId,
				events: batch.map((item) => item.event),
				idempotencyKeys,
			})
		);
	});
}

function buildChannel(state: ChannelState): DuplexChannel {
	return {
		sendEvents: (batch) => sendEventsOnChannel(state, batch),
		onCommand: (fn) => {
			state.commandHandler = fn;
		},
		onDown: (fn) => {
			state.downHandler = fn;
		},
		close: () => {
			state.closed = true;
			state.socket.close();
		},
	};
}

/**
 * Opens the WS duplex channel: one handshake (`hello` → `hello_ok`), then a
 * live `DuplexChannel` that reconnects with backoff on any later drop —
 * invisible to the caller until (if) it gives up for good. Resolves `null`
 * (never rejects) if that FIRST handshake fails — the endpoint being absent
 * or the upgrade failing outright, e.g. an older server or the Workers test
 * environment, is exactly the case `run-bridge-session.ts` falls back to
 * `pollLoop`/HTTP for.
 */
export async function connectDuplexChannel(
	config: OpenDuplexConfig
): Promise<DuplexChannel | null> {
	let socket: WsLike;
	try {
		socket = await attemptHandshake({
			afterId: config.afterId,
			headers: config.headers,
			sessionId: config.sessionId,
			url: config.url,
			wsFactory: config.wsFactory,
		});
	} catch {
		return null;
	}

	const state: ChannelState = {
		closed: false,
		commandHandler: null,
		config,
		downFired: false,
		downHandler: null,
		lastCommandId: config.afterId,
		nextBatchSeq: 0,
		pending: new Map(),
		reconnecting: false,
		socket,
	};
	bindSocket(state, socket);
	return buildChannel(state);
}
