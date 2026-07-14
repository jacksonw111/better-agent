// Relay data layer for the local agent bridge: pushes live events to a
// connected web client and keeps a short rolling-window replay buffer so a
// client that reconnects (or that was briefly disconnected) can catch up.

/** Which direction an event flows through the bridge. */
export type RelayDir = "events" | "commands";

/** A single relayed item; `id` is monotonic per (sessionId, dir). */
export interface RelayEvent {
	data: unknown;
	id: number;
}

/**
 * Result of `append`. `isNew` is `false` when `idempotencyKey` had already
 * been appended for this (sessionId, dir): `id` is then the id of that
 * EXISTING event, and no new event was created — no window insert, no
 * subscriber notification. Lets a caller (`appendPushedEvents`, see
 * `packages/api/src/routers/bridge-push-events.ts`) skip a resent batch's
 * per-event side effects (persistence, usage dual-write, …) instead of
 * re-running them for a no-op.
 */
export interface RelayAppendResult {
	id: number;
	isNew: boolean;
}

/** Max events retained per (sessionId, dir) for replay. */
export const MAX_WINDOW = 500;
/** TTL (seconds) applied to the Redis-backed replay window. */
export const WINDOW_TTL_SEC = 900;

export interface RelayStore {
	/**
	 * Appends `data`, notifies live subscribers, and returns the new id — or,
	 * when `idempotencyKey` was already seen for this (sessionId, dir), a
	 * no-op that returns the EXISTING id instead of creating a duplicate
	 * event (see `RelayAppendResult`).
	 *
	 * This is what makes event delivery idempotent: the CLI's push-queue
	 * (`apps/bridge-cli/src/push-queue.ts`) resends a whole batch verbatim
	 * when a successful push's ack is lost, carrying the SAME client-minted
	 * idempotency keys — see `docs/remote-control-redesign-plan.md`'s T1.
	 * Without this, the resend would land as fresh events (a fresh id each),
	 * duplicating them past every id-based dedup downstream (web
	 * `event-feed.ts`, `stream.ts`'s `seen` set).
	 *
	 * `idempotencyKey` is optional: the `commands` direction (`sendInput`,
	 * `endSession`'s stop command) isn't retried at this layer, so omitting
	 * it always appends — the pre-T1 behavior.
	 */
	append(
		sessionId: string,
		dir: RelayDir,
		data: unknown,
		idempotencyKey?: string
	): Promise<RelayAppendResult>;
	/** Replays events with id > afterId, in order (fallback for a gap in live push). */
	read(
		sessionId: string,
		dir: RelayDir,
		afterId: number
	): Promise<RelayEvent[]>;
	/**
	 * The LAST `limit` events of the window, in id order — a bounded tail read
	 * for derivations that only need the stream's recent shape (P2-T1:
	 * `listSessions`'s per-session attention signal), so a caller inspecting
	 * many sessions per request never pulls each one's full replay window.
	 */
	readTail(
		sessionId: string,
		dir: RelayDir,
		limit: number
	): Promise<RelayEvent[]>;
	/**
	 * Live push; returns an unsubscribe function.
	 *
	 * Call subscribe() before read(afterId): append persists to the window
	 * before publishing, so that order guarantees no event is missed
	 * (duplicates across replay+live are possible; dedupe by id).
	 */
	subscribe(
		sessionId: string,
		dir: RelayDir,
		onEvent: (event: RelayEvent) => void
	): () => void;
}

interface RelayChannelState {
	events: RelayEvent[];
	/** id -> idempotencyKey, the reverse of `seenKeys` — used only to prune
	 * `seenKeys` in step with `events` as an event ages out of the window. */
	keyById: Map<number, string>;
	listeners: Set<(event: RelayEvent) => void>;
	/** idempotencyKey -> id, scoped to events currently within the MAX_WINDOW
	 * retention window (pruned alongside `events`, see `pruneWindow`) —
	 * bounds this map's size instead of growing it unboundedly over a
	 * long-lived session. A key aging out just means a (by-then-ancient)
	 * retry would no longer dedupe, which is moot in practice: the push-queue
	 * gives up on a batch after MAX_PUSH_RETRIES, long before MAX_WINDOW
	 * events pass through the same channel. */
	seenKeys: Map<string, number>;
	seq: number;
}

function keyFor(sessionId: string, dir: RelayDir): string {
	return `${sessionId}:${dir}`;
}

/** Trims `channel.events` down to `MAX_WINDOW`, pruning `seenKeys`/`keyById`
 * for whatever falls out — split out of `append` to keep it small. */
function pruneWindow(channel: RelayChannelState): void {
	if (channel.events.length <= MAX_WINDOW) {
		return;
	}
	const removed = channel.events.splice(0, channel.events.length - MAX_WINDOW);
	for (const event of removed) {
		const key = channel.keyById.get(event.id);
		if (key !== undefined) {
			channel.seenKeys.delete(key);
			channel.keyById.delete(event.id);
		}
	}
}

function getOrCreateChannel(
	channels: Map<string, RelayChannelState>,
	sessionId: string,
	dir: RelayDir
): RelayChannelState {
	const key = keyFor(sessionId, dir);
	let channel = channels.get(key);
	if (!channel) {
		channel = {
			seq: 0,
			events: [],
			listeners: new Set(),
			seenKeys: new Map(),
			keyById: new Map(),
		};
		channels.set(key, channel);
	}
	return channel;
}

/** Core of `RelayStore.append` against an already-resolved channel — split
 * out so `createInMemoryRelayStore` itself stays under the function-length
 * cap. See `RelayStore.append`'s doc comment for the idempotency semantics. */
function appendToChannel(
	channel: RelayChannelState,
	data: unknown,
	idempotencyKey?: string
): RelayAppendResult {
	if (idempotencyKey !== undefined) {
		const existingId = channel.seenKeys.get(idempotencyKey);
		if (existingId !== undefined) {
			return { id: existingId, isNew: false };
		}
	}

	channel.seq += 1;
	const event: RelayEvent = { id: channel.seq, data };
	channel.events.push(event);
	if (idempotencyKey !== undefined) {
		channel.seenKeys.set(idempotencyKey, event.id);
		channel.keyById.set(event.id, idempotencyKey);
	}
	pruneWindow(channel);

	for (const listener of channel.listeners) {
		listener(event);
	}

	return { id: event.id, isNew: true };
}

export function createInMemoryRelayStore(): RelayStore {
	const channels = new Map<string, RelayChannelState>();

	return {
		append(sessionId, dir, data, idempotencyKey) {
			const channel = getOrCreateChannel(channels, sessionId, dir);
			return Promise.resolve(appendToChannel(channel, data, idempotencyKey));
		},

		read(sessionId, dir, afterId) {
			const channel = getOrCreateChannel(channels, sessionId, dir);
			return Promise.resolve(
				channel.events.filter((event) => event.id > afterId)
			);
		},

		readTail(sessionId, dir, limit) {
			if (limit <= 0) {
				return Promise.resolve([]);
			}
			const channel = getOrCreateChannel(channels, sessionId, dir);
			return Promise.resolve(channel.events.slice(-limit));
		},

		subscribe(sessionId, dir, onEvent) {
			const channel = getOrCreateChannel(channels, sessionId, dir);
			channel.listeners.add(onEvent);
			return () => {
				channel.listeners.delete(onEvent);
			};
		},
	};
}
