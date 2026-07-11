// R0-T2 (local-agent transport refactor): the WS duplex channel's handshake
// and reconnect-with-backoff machinery — split out of ws-duplex.ts purely to
// keep that file's line count down. Reconnecting happens entirely INSIDE
// this module (per the pinned design, "invisible to the session loop"):
// ws-duplex.ts's public `DuplexChannel` never knows a drop happened unless
// `onDown` eventually fires.

import type { ServerFrame } from "@better-agent/api/bridge/ws-session";
import type { ChannelState } from "./ws-duplex";
import {
	MAX_CONSECUTIVE_RECONNECT_FAILURES,
	reconnectDelayMs,
} from "./ws-duplex-backoff";
import {
	handleServerMessage,
	parseServerFrame,
	sendFrame,
} from "./ws-duplex-frames";
import type { WsFactory, WsLike } from "./ws-duplex-socket";

function defaultSleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

interface HandshakeArgs {
	afterId: number;
	headers: Record<string, string>;
	sessionId: string;
	url: string;
	wsFactory: WsFactory;
}

/** Opens one socket, sends `hello`, and resolves with that (still-open)
 * socket once `hello_ok` arrives — or rejects on a socket error, an
 * unexpected close, or a fatal `error` frame, whichever comes first. Used
 * both for the very first connection (ws-duplex.ts's `connectDuplexChannel`)
 * and every reconnect attempt below — the only difference is what the caller
 * does with a rejection. */
export function attemptHandshake(args: HandshakeArgs): Promise<WsLike> {
	return new Promise((resolve, reject) => {
		const socket = args.wsFactory(args.url, args.headers);
		let settled = false;

		const fail = (reason: unknown) => {
			if (settled) {
				return;
			}
			settled = true;
			reject(reason instanceof Error ? reason : new Error(String(reason)));
		};

		socket.on("open", () => {
			sendFrame(socket, {
				t: "hello",
				sessionId: args.sessionId,
				afterId: args.afterId,
			});
		});
		socket.on("message", (data) => {
			if (settled) {
				return;
			}
			const frame: ServerFrame | null = parseServerFrame(data);
			if (frame?.t === "hello_ok") {
				settled = true;
				resolve(socket);
			} else if (frame?.t === "error") {
				fail(frame.message);
			}
		});
		socket.on("close", (code, reason) => fail(reason ?? `closed (${code})`));
		socket.on("error", fail);
	});
}

/** Attaches the STEADY-STATE listeners a live socket keeps for as long as
 * it's the channel's current one: routes every message through
 * `handleServerMessage`, and treats any close/error as an unexpected drop —
 * kicking off `onSocketDown` unless the channel itself is the one that
 * closed it (`state.closed`). */
export function bindSocket(state: ChannelState, socket: WsLike): void {
	socket.on("message", (data) => handleServerMessage(state, data));
	socket.on("close", (_code, reason) =>
		onSocketDown(state, reason ?? "socket closed")
	);
	socket.on("error", (error) => onSocketDown(state, error));
}

/** Re-sends every still-unacked batch's exact original `events` frame (same
 * `batchId`/`idempotencyKeys`) once a reconnect succeeds — the server's
 * relay-store dedup (keyed on those idempotency keys) is what makes a resend
 * safe even if the original attempt's `events_ack` was simply lost, not
 * actually dropped. */
function resendPending(state: ChannelState): void {
	for (const [batchId, pending] of state.pending) {
		sendFrame(state.socket, {
			t: "events",
			batchId,
			events: pending.batch.map((item) => item.event),
			idempotencyKeys: pending.idempotencyKeys,
		});
	}
}

/** Rejects every still-unacked `sendEvents` call and fires `onDown` exactly
 * once — the channel is irrecoverably dead from here on; `close()` becomes a
 * no-op and no further reconnect attempts happen. */
function fireDown(state: ChannelState, reason: string): void {
	if (state.downFired) {
		return;
	}
	state.downFired = true;
	state.closed = true;
	for (const pending of state.pending.values()) {
		pending.reject(new Error(`bridge: ws channel down: ${reason}`));
	}
	state.pending.clear();
	state.downHandler?.(reason);
}

/** One reconnect attempt: waits its backoff delay, then re-handshakes with
 * the CURRENT `state.lastCommandId` as `afterId` (so the server never
 * replays a command already delivered) — on success, rebinds the socket and
 * flushes every unacked batch; on failure, the caller (`reconnectLoop`)
 * decides whether to try again. */
async function reconnectOnce(
	state: ChannelState,
	sleep: (ms: number) => Promise<void>,
	attempt: number
): Promise<boolean> {
	await sleep(reconnectDelayMs(attempt));
	if (state.closed) {
		return true; // channel closed while we were waiting — stop, not a failure
	}
	try {
		const socket = await attemptHandshake({
			afterId: state.lastCommandId,
			headers: state.config.headers,
			sessionId: state.config.sessionId,
			url: state.config.url,
			wsFactory: state.config.wsFactory,
		});
		state.socket = socket;
		bindSocket(state, socket);
		resendPending(state);
		return true;
	} catch {
		return false;
	}
}

/** Retries `reconnectOnce` until it succeeds or
 * `MAX_CONSECUTIVE_RECONNECT_FAILURES` consecutive attempts have failed, in
 * which case the channel is declared irrecoverably down (`fireDown`). Only
 * one instance of this loop ever runs at a time per channel — see
 * `onSocketDown`'s `state.reconnecting` guard, needed because a real socket
 * commonly fires BOTH 'error' and 'close' for the same drop. */
async function reconnectLoop(state: ChannelState): Promise<void> {
	const sleep = state.config.sleep ?? defaultSleep;
	for (
		let attempt = 0;
		attempt < MAX_CONSECUTIVE_RECONNECT_FAILURES;
		attempt++
	) {
		const ok = await reconnectOnce(state, sleep, attempt);
		if (ok) {
			return;
		}
	}
	fireDown(
		state,
		`reconnect failed after ${MAX_CONSECUTIVE_RECONNECT_FAILURES} attempts`
	);
}

/** Kicks off `reconnectLoop` for an unexpected socket drop — a no-op if the
 * channel already closed on purpose (`close()` was called) or a reconnect
 * attempt is already in flight. */
export function onSocketDown(state: ChannelState, _reason: unknown): void {
	if (state.closed || state.reconnecting) {
		return;
	}
	state.reconnecting = true;
	reconnectLoop(state).finally(() => {
		state.reconnecting = false;
	});
}
