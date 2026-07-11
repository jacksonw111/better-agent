// R0-T2 (local-agent transport refactor): wire-frame helpers for the WS
// duplex channel — serializing outbound `ClientFrame`s and parsing/routing
// inbound `ServerFrame`s. Split out of ws-duplex.ts purely to keep that
// file's line count down. `ClientFrame`/`ServerFrame` are imported
// TYPE-ONLY from the server's own zod schemas
// (@better-agent/api/bridge/ws-session) so the two sides can never silently
// drift out of sync.

import type {
	ClientFrame,
	ServerFrame,
} from "@better-agent/api/bridge/ws-session";
import type { ChannelState } from "./ws-duplex";
import type { WsLike } from "./ws-duplex-socket";

export function sendFrame(socket: WsLike, frame: ClientFrame): void {
	socket.send(JSON.stringify(frame));
}

/** `ws`'s `message` event hands the listener a `Buffer` (for a text frame) or
 * a plain string, depending on the socket implementation — `String(raw)`
 * covers both (a `Buffer` overrides `toString()` to utf8-decode itself, same
 * as a template literal would do). Returns `null` for anything that isn't
 * valid JSON — malformed frames are ignored, not thrown. */
export function parseServerFrame(raw: unknown): ServerFrame | null {
	try {
		const text = typeof raw === "string" ? raw : String(raw);
		return JSON.parse(text) as ServerFrame;
	} catch {
		return null;
	}
}

/** Dispatches one `command` frame to `state.commandHandler` and only then
 * advances `state.lastCommandId` — deliberately AFTER, not before, so a
 * handler that throws/rejects (e.g. `run-bridge-session-duplex.ts`'s
 * `sink.send` failing) leaves `lastCommandId` at the command BEFORE this one,
 * getting it redelivered on the next reconnect handshake instead of the
 * server skipping straight past it. The handler itself is responsible for
 * surfacing the error (mirrors poll-loop.ts's `onError`) — this function only
 * owns the afterId bookkeeping, so it deliberately swallows the rejection
 * after leaving `lastCommandId` alone. */
async function handleCommandFrame(
	state: ChannelState,
	frame: Extract<ServerFrame, { t: "command" }>
): Promise<void> {
	try {
		await state.commandHandler?.({ id: frame.id, data: frame.data });
		state.lastCommandId = frame.id;
	} catch {
		// Dispatch failed — see doc comment above; nothing else to do here.
	}
}

function handleEventsAckFrame(
	state: ChannelState,
	frame: Extract<ServerFrame, { t: "events_ack" }>
): void {
	const pending = state.pending.get(frame.batchId);
	if (!pending) {
		return;
	}
	state.pending.delete(frame.batchId);
	pending.resolve();
}

/** Routes one parsed server frame to the matching handler. `hello_ok` never
 * reaches here in steady state (only expected during the handshake — see
 * ws-duplex-reconnect.ts's `attemptHandshake`) and a fatal `error` frame
 * needs no handling of its own: the server closes the socket right after
 * sending it, and the 'close' listener bound alongside this one is what
 * drives the reconnect. */
export function handleServerMessage(state: ChannelState, raw: unknown): void {
	const frame = parseServerFrame(raw);
	if (!frame || frame.t === "hello_ok" || frame.t === "error") {
		return;
	}
	if (frame.t === "command") {
		// Fire-and-forget: `handleCommandFrame`'s own try/catch swallows every
		// failure internally (see its doc comment) — it never rejects.
		handleCommandFrame(state, frame);
	} else {
		handleEventsAckFrame(state, frame);
	}
}
