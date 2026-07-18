import type { BridgeMessageStore } from "@better-agent/agent/ports";
import { log } from "evlog";

// B3 loss fix: bridge_messages persistence used to be one try, logged and
// swallowed — once the relay window TTL'd out, an event that missed that one
// write was gone from history forever. Persistence now retries with
// exponential backoff, and a batch that still fails lands in an in-process
// compensation queue that keeps retrying in the background until the DB
// recovers (bounded, oldest dropped first, every failure counted in logs).

/** Backoff between persistence attempts — total attempts = length + 1. */
export const PERSIST_RETRY_DELAYS_MS: readonly number[] = [250, 500];
/** How often the compensation queue retries batches that exhausted their
 * inline attempts. */
export const COMPENSATION_FLUSH_INTERVAL_MS = 30_000;
/** Bound on queued batches — beyond it the OLDEST batch is dropped (and
 * counted in logs) so a long DB outage can't grow memory unboundedly. */
export const MAX_COMPENSATION_BATCHES = 200;

/** The single store capability this module needs — narrowed so tests can pass
 * a two-line fake instead of a full BridgeMessageStore. */
export type PersistTarget = Pick<BridgeMessageStore, "appendMany">;

export interface PersistRows {
	rows: { event: unknown; seq: number }[];
	sessionId: string;
}

interface PendingBatch extends PersistRows {
	failures: number;
	store: PersistTarget;
}

const compensationQueue: PendingBatch[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => {
		setTimeout(resolve, ms);
	});
}

/** `unref` exists on Node's Timeout but not on a browser/Workers number — the
 * background flush must never keep a Node process alive on its own. */
function maybeUnref(timer: ReturnType<typeof setTimeout>): void {
	if (typeof timer === "object" && timer !== null && "unref" in timer) {
		(timer as { unref: () => void }).unref();
	}
}

function ensureFlushScheduled(): void {
	if (flushTimer !== null || compensationQueue.length === 0) {
		return;
	}
	flushTimer = setTimeout(() => {
		flushTimer = null;
		flushCompensationQueue()
			.then(() => ensureFlushScheduled())
			.catch(() => ensureFlushScheduled());
	}, COMPENSATION_FLUSH_INTERVAL_MS);
	maybeUnref(flushTimer);
}

function enqueueCompensation(batch: PendingBatch): void {
	compensationQueue.push(batch);
	if (compensationQueue.length > MAX_COMPENSATION_BATCHES) {
		const dropped = compensationQueue.shift();
		log.error({
			action: "bridge persist compensation overflow",
			droppedRows: dropped?.rows.length ?? 0,
			droppedSessionId: dropped?.sessionId,
			queued: compensationQueue.length,
		});
	}
	log.error({
		action: "bridge persist exhausted inline retries",
		failures: batch.failures,
		queued: compensationQueue.length,
		rows: batch.rows.length,
		sessionId: batch.sessionId,
	});
	ensureFlushScheduled();
}

/** One pass over the compensation queue: each batch gets a single retry;
 * still-failing batches stay queued with their failure count bumped. */
export async function flushCompensationQueue(): Promise<void> {
	const batches = compensationQueue.splice(0, compensationQueue.length);
	for (const batch of batches) {
		try {
			await batch.store.appendMany(batch.sessionId, batch.rows);
		} catch (err) {
			batch.failures += 1;
			compensationQueue.push(batch);
			log.warn({
				action: "bridge persist compensation retry failed",
				error: String(err),
				failures: batch.failures,
				rows: batch.rows.length,
				sessionId: batch.sessionId,
			});
		}
	}
	ensureFlushScheduled();
}

/** How many batches are currently awaiting compensation — exposed for tests
 * and health probes. */
export function compensationQueueSize(): number {
	return compensationQueue.length;
}

/** Drops queued batches and cancels the background flush — test isolation. */
export function resetPersistRetryForTests(): void {
	compensationQueue.length = 0;
	if (flushTimer !== null) {
		clearTimeout(flushTimer);
		flushTimer = null;
	}
}

/**
 * Persists `rows` with inline exponential-backoff retries; a batch that still
 * fails is parked in the compensation queue instead of being dropped. Never
 * throws — a persistence problem must never break the live relay path
 * (ingest-events.ts).
 */
export async function persistEventsWithRetry(
	store: PersistTarget,
	input: PersistRows,
	delaysMs: readonly number[] = PERSIST_RETRY_DELAYS_MS
): Promise<void> {
	if (input.rows.length === 0) {
		return;
	}
	let attempt = 1;
	for (;;) {
		try {
			await store.appendMany(input.sessionId, input.rows);
			return;
		} catch (err) {
			log.warn({
				action: "bridge persist attempt failed",
				attempt,
				error: String(err),
				rows: input.rows.length,
				sessionId: input.sessionId,
			});
			const delay = delaysMs[attempt - 1];
			if (delay === undefined) {
				break;
			}
			attempt += 1;
			await sleep(delay);
		}
	}
	enqueueCompensation({ ...input, failures: attempt, store });
}
