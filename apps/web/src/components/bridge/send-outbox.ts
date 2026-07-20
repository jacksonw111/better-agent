// fix-send-outbox: the reliability layer under every web → server send on a
// bridge session (chat messages AND control commands: approval decisions,
// interrupt, setModel, …).
//
// Before this, `sendInput` was a bare `await transport.sendInput(...)` fired
// AFTER the message had already been echoed optimistically into the feed: a
// single flaky request dropped the message on the floor while the user kept
// looking at their own line in the transcript, with no error anywhere. This
// module fixes that end to end — a serial queue, exponential-backoff retries,
// `sessionStorage` persistence across a reload (send-outbox-storage.ts), and a
// client-minted idempotency key per message so a retry that follows a send the
// server DID receive (but whose response was lost) never double-delivers to
// the agent (see `bridge.sendInput` in packages/api/src/routers/bridge.ts).
//
// Deliberately framework-free (a factory, not a hook) so the hard parts —
// retry-then-succeed, exhaustion, ordering, restore — are testable as plain
// async unit tests with an injected clock. `use-send-outbox.ts` is the thin
// React binding.

import {
	defaultOutboxStorage,
	loadOutbox,
	saveOutbox,
} from "./send-outbox-storage";
import type {
	OutboxEntry,
	SendOutbox,
	SendOutboxOptions,
} from "./send-outbox-types";

/** First retry delay after a failed send. */
export const SEND_RETRY_BASE_MS = 500;
/** Each subsequent retry waits this many times longer than the previous one. */
export const SEND_RETRY_FACTOR = 2;
/** Ceiling on one retry's wait — past this the backoff flattens, so a long
 * outage still reconnects promptly once the network returns. */
export const SEND_RETRY_MAX_MS = 8000;
/** Total send attempts (the first try plus its retries) before an entry is
 * declared failed. */
export const MAX_SEND_ATTEMPTS = 6;

/** Delay before the `attempt`-th retry (1-based): `BASE * FACTOR^(attempt-1)`,
 * flattened at `SEND_RETRY_MAX_MS`. */
export function retryDelayMs(attempt: number): number {
	const scaled = SEND_RETRY_BASE_MS * SEND_RETRY_FACTOR ** (attempt - 1);
	return Math.min(scaled, SEND_RETRY_MAX_MS);
}

const FALLBACK_KEY_RADIX = 16;

/** Mints one send's idempotency key. Exported so a caller that must know the
 * key BEFORE the send is queued (the chat path echoes the line under it, see
 * use-send-outbox.ts) can pass its own in. */
export function mintOutboxKey(): string {
	return typeof crypto?.randomUUID === "function"
		? crypto.randomUUID()
		: `outbox-${Date.now()}-${Math.random().toString(FALLBACK_KEY_RADIX).slice(2)}`;
}

function defaultSleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Fire-and-forget for the drain: it settles every entry through the outbox's
 * own bookkeeping (and a chat send never rejects), so there is nothing for the
 * caller to await or handle — this just says so explicitly instead of leaving
 * a floating promise. */
function ignore(promise: Promise<void>): void {
	promise.catch(() => undefined);
}

interface Deferred {
	reject: (error: unknown) => void;
	resolve: () => void;
}

/** The queue and the four mutations every path goes through — each of which
 * persists and republishes, so no caller can move an entry without the stored
 * copy and the UI following. */
interface QueueState {
	entries: () => OutboxEntry[];
	patch: (key: string, changes: Partial<OutboxEntry>) => void;
	push: (entry: OutboxEntry) => void;
	remove: (key: string) => void;
	/** Settles the enqueue promise, if this entry still has one (a restored
	 * entry has none — its original caller is gone with the old page). */
	settle: (key: string, error?: unknown) => void;
}

function createQueueState(
	options: SendOutboxOptions,
	storage: Storage | null,
	deferreds: Map<string, Deferred>
): QueueState {
	let entries = loadOutbox(options.sessionId, storage);
	const commit = (next: OutboxEntry[]): void => {
		entries = next;
		saveOutbox(options.sessionId, next, storage);
		options.onChange?.(next);
	};
	return {
		entries: () => entries,
		patch: (key, changes) =>
			commit(
				entries.map((entry) =>
					entry.key === key ? { ...entry, ...changes } : entry
				)
			),
		push: (entry) => commit([...entries, entry]),
		remove: (key) => commit(entries.filter((entry) => entry.key !== key)),
		settle: (key, error) => {
			const deferred = deferreds.get(key);
			deferreds.delete(key);
			if (!deferred) {
				return;
			}
			if (error === undefined) {
				deferred.resolve();
			} else {
				deferred.reject(error);
			}
		},
	};
}

/** Retries exhausted. A control command leaves the queue immediately — its
 * rejection IS the report (rollback + toast at the call site), and parking it
 * at the head would block every chat message behind it. A chat line stays,
 * marked failed, for the feed's retry/discard affordance. Returns whether the
 * drain may keep going. */
function handleExhausted(
	options: SendOutboxOptions,
	state: QueueState,
	entry: OutboxEntry,
	error: unknown
): boolean {
	if (entry.echoText === undefined) {
		state.remove(entry.key);
		state.settle(entry.key, error);
		return true;
	}
	state.patch(entry.key, { attempts: MAX_SEND_ATTEMPTS, status: "failed" });
	options.onStatus?.(entry.key, "failed");
	state.settle(entry.key);
	return false;
}

/** One attempt at the head entry. Returns whether the drain should keep going;
 * a `false` parks the queue behind a failed chat line, which is what preserves
 * the user's send ORDER (their messages read as a sequence). */
async function attemptHead(
	options: SendOutboxOptions,
	state: QueueState,
	sleep: (ms: number) => Promise<void>
): Promise<boolean> {
	const head = state.entries()[0];
	if (!head || head.status === "failed") {
		return false;
	}
	state.patch(head.key, { status: "sending" });
	options.onStatus?.(head.key, "sending");
	try {
		await options.send({
			data: head.data,
			idempotencyKey: head.key,
			sessionId: options.sessionId,
		});
	} catch (error) {
		const attempts = head.attempts + 1;
		if (attempts >= MAX_SEND_ATTEMPTS) {
			return handleExhausted(options, state, head, error);
		}
		state.patch(head.key, { attempts, status: "queued" });
		await sleep(retryDelayMs(attempts));
		return true;
	}
	state.remove(head.key);
	options.onStatus?.(head.key, "sent");
	state.settle(head.key);
	return true;
}

export function createSendOutbox(options: SendOutboxOptions): SendOutbox {
	const sleep = options.sleep ?? defaultSleep;
	const makeKey = options.makeKey ?? mintOutboxKey;
	const storage =
		options.storage === undefined ? defaultOutboxStorage() : options.storage;
	const deferreds = new Map<string, Deferred>();
	const state = createQueueState(options, storage, deferreds);
	/** The tail of the drain chain — see `drain`. */
	let draining: Promise<void> = Promise.resolve();

	const runLoop = async (): Promise<void> => {
		let keepGoing = true;
		while (keepGoing) {
			keepGoing = await attemptHead(options, state, sleep);
		}
	};
	/** Drains by CHAINING onto whatever drain is already running, rather than
	 * bailing out when one is: the returned promise then always covers this
	 * caller's own pass (a manual `retry` awaits its resend, not someone else's
	 * loop), while the chain still guarantees only one send is ever in flight.
	 * A pass that starts with nothing to do finishes immediately. */
	const drain = (): Promise<void> => {
		draining = draining.then(runLoop, runLoop);
		return draining;
	};

	return {
		discard(key) {
			state.remove(key);
			options.onStatus?.(key, "discarded");
			state.settle(key);
			ignore(drain());
		},
		drain,
		enqueue({ data, echoText, key }) {
			const entryKey = key ?? makeKey();
			state.push({
				attempts: 0,
				data,
				key: entryKey,
				status: "queued",
				...(echoText === undefined ? {} : { echoText }),
			});
			const settled = new Promise<void>((resolve, reject) => {
				deferreds.set(entryKey, { reject, resolve });
			});
			ignore(drain());
			return settled;
		},
		entries: state.entries,
		retry(key) {
			state.patch(key, { attempts: 0, status: "queued" });
			return drain();
		},
	};
}
