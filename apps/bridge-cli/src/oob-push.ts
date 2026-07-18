// A1 (event-loss audit): the shared reliable channel for OUT-OF-BAND event
// pushes — everything that reaches the relay outside `forwardEvents`' main
// stream: the shell runner's tool events, image-download failure notes, the
// watchdog's "stalled" marker, task-launch's start-context echo and
// resume_failed notice, and the session-end status. Each of those sites used
// to be a lone `transport.pushEvents(...).catch(() => undefined)` — one
// attempt, no idempotency key, errors swallowed silently — so a transient
// relay hiccup lost exactly the events a reopened session most needs.
//
// This wraps the SAME bounded retry queue the main stream uses
// (push-queue.ts: backoff, per-batch retry bound, abort-flush grace) in a
// tiny fire-and-forget `push(source, event)` facade. Keys are minted as
// `oob:<epoch>:<seq>` — the `oob:` prefix keeps them disjoint from
// forwardEvents' `<generation>:<counter>` keys, and the creation-time epoch
// keeps them unique across process restarts that reuse a sessionId. When
// delivery ultimately fails anyway, there's always a warning — never
// silence.

import { createPushQueue, type Sleep } from "./push-queue";

/** Which out-of-band site produced an event — logged as
 * `cli.emit.oob source=<source>` for the event-loss instrumentation (A4). */
export type OobSource =
	| "image"
	| "outcome"
	| "shell"
	| "taskstart"
	| "watchdog";

export type OobPush = (source: OobSource, event: unknown) => void;

export interface OobSender {
	/** Best-effort flush of everything still queued (bounded by
	 * `closeTimeoutMs`), then stops. Always resolves — a failed or timed-out
	 * flush warns instead of throwing. */
	close(): Promise<void>;
	/** Enqueues one event for reliable delivery. Never throws, never blocks. */
	push: OobPush;
}

export interface CreateOobSenderOptions {
	/** How long `close()` waits for the final flush before giving up with a
	 * warning. Defaults to `OOB_CLOSE_TIMEOUT_MS`. */
	closeTimeoutMs?: number;
	/** Idempotency-key salt; defaults to `Date.now()` at creation. */
	epoch?: number;
	/** A4 instrumentation sink (`cli.emit.oob source=…`); defaults to stderr. */
	log?: (line: string) => void;
	onWarning?: (message: string) => void;
	pushEvents(input: {
		events: unknown[];
		idempotencyKeys?: string[];
		sessionId: string;
	}): Promise<void>;
	sessionId: string;
	sleep?: Sleep;
}

interface OobItem {
	event: unknown;
	idempotencyKey: string;
}

/** Out-of-band events are rare (a shell command's throttled previews, a
 * handful of status markers), so a modest backlog bound is plenty. */
const OOB_MAX_BUFFERED_EVENTS = 200;
const OOB_CLOSE_TIMEOUT_MS = 3000;

function writeStderrLine(line: string): void {
	process.stderr.write(`${line}\n`);
}

/** A real-time timeout that never keeps the process alive on its own. */
function closeTimeout(ms: number): Promise<"timeout"> {
	return new Promise((resolve) => {
		const timer = setTimeout(() => resolve("timeout"), ms);
		timer.unref?.();
	});
}

/** `close()`'s bounded best-effort flush: waits for the queue to drain, but
 * no longer than `timeoutMs` — a timeout (or a fatal batch failure, already
 * warned about via `queue.fatal`) resolves with a warning, never throws. */
async function flushBounded(
	queue: { close(): Promise<void> },
	timeoutMs: number,
	warn: (message: string) => void
): Promise<void> {
	try {
		const finished = await Promise.race([
			queue.close(),
			closeTimeout(timeoutMs),
		]);
		if (finished === "timeout") {
			warn(
				`bridge: out-of-band flush timed out after ${timeoutMs}ms — undelivered event(s) were dropped`
			);
		}
	} catch {
		// A fatal batch failure already warned via `queue.fatal`.
	}
}

export function createOobSender(options: CreateOobSenderOptions): OobSender {
	const epoch = options.epoch ?? Date.now();
	const warn = options.onWarning ?? writeStderrLine;
	const log = options.log ?? writeStderrLine;
	let seq = 0;
	let dead = false;
	const queue = createPushQueue<OobItem>({
		maxBufferedEvents: OOB_MAX_BUFFERED_EVENTS,
		onWarning: warn,
		push: (batch) =>
			options.pushEvents({
				events: batch.map((item) => item.event),
				idempotencyKeys: batch.map((item) => item.idempotencyKey),
				sessionId: options.sessionId,
			}),
		sleep: options.sleep,
	});
	// A batch that exhausts its retries kills the queue's sender loop — from
	// then on this channel is dead, and every further push is warned about
	// instead of piling up (or, worse, being silently swallowed).
	queue.fatal.catch((error: unknown) => {
		dead = true;
		warn(
			`bridge: out-of-band push channel failed permanently: ${String(error)}`
		);
	});

	return {
		push(source, event): void {
			if (dead) {
				warn(
					`bridge: dropped out-of-band ${source} event — push channel failed permanently`
				);
				return;
			}
			seq += 1;
			log(`cli.emit.oob source=${source}`);
			queue.enqueue([{ event, idempotencyKey: `oob:${epoch}:${seq}` }]);
		},
		close: (): Promise<void> =>
			flushBounded(queue, options.closeTimeoutMs ?? OOB_CLOSE_TIMEOUT_MS, warn),
	};
}
