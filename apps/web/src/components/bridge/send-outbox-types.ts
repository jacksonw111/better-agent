// fix-send-outbox: the send outbox's shared shapes, split out of
// send-outbox.ts (which owns the queue itself) so both it and the storage
// layer can name them without either importing the other — and so both files
// stay under the repo's max-lines-per-file gate.

/** What the feed is told about one queued send, so the user's own echoed line
 * can never sit there looking delivered when it isn't. "sent"/"discarded" are
 * terminal: the echo goes back to an ordinary message / is removed. */
export type EchoSendStatus = "discarded" | "failed" | "sending" | "sent";

export type OutboxStatus = "failed" | "queued" | "sending";

export interface OutboxEntry {
	/** Failed send attempts so far — drives the backoff and the give-up gate. */
	attempts: number;
	/** The exact payload handed to `bridge.sendInput` (a plain string for a
	 * chat line, a `{type: "control", …}` object for a command). */
	data: unknown;
	/** The echoed chat text this entry belongs to — present ONLY for chat
	 * sends. Its absence is what marks an entry as a control command, which is
	 * reported through its rejected promise rather than a feed line (see
	 * `handleExhausted`), and it is what lets a restored outbox re-create the
	 * echo after a reload. */
	echoText?: string;
	/** The client-minted idempotency key, stable across every retry. */
	key: string;
	status: OutboxStatus;
}

export interface OutboxSendArgs {
	data: unknown;
	idempotencyKey: string;
	sessionId: string;
}

export interface SendOutboxOptions {
	/** Mints an entry's idempotency key; defaults to `crypto.randomUUID()`. */
	makeKey?: () => string;
	/** Notified with the queue after every mutation — the React binding's
	 * `useSyncExternalStore`-ish hook. */
	onChange?: (entries: OutboxEntry[]) => void;
	/** Notified as one entry's user-visible send state moves, so the feed can
	 * reflect it on the echoed line. */
	onStatus?: (key: string, status: EchoSendStatus) => void;
	send: (args: OutboxSendArgs) => Promise<void>;
	sessionId: string;
	/** Injected in tests so six attempts don't wait out the real backoff. */
	sleep?: (ms: number) => Promise<void>;
	/** Injected in tests; defaults to `sessionStorage` when the environment has
	 * one, and to no persistence at all when it doesn't (SSR, unit tests). */
	storage?: Storage | null;
}

export interface SendOutbox {
	/** Removes an entry (a failed chat line the user chose to drop) and
	 * settles it — the feed drops its echo on the `"discarded"` status. */
	discard: (key: string) => void;
	/** Kicks the serial drain; safe to call at any time (a second call while
	 * one is running is a no-op). Awaited by the React binding on mount so a
	 * restored queue resumes. */
	drain: () => Promise<void>;
	/**
	 * Queues one send and returns a promise that settles when it is finally
	 * delivered — or, for a CONTROL command, rejects once the retries are
	 * exhausted, preserving the existing rollback-and-toast behavior of
	 * `makeAnswerApproval`/`sendControlCommand`. A CHAT send (one with
	 * `echoText`) never rejects: its failure is carried by the feed's own
	 * failed line, and rejecting would surface as an unhandled rejection
	 * anyway since the composer's `onSend` returns void.
	 */
	enqueue: (args: {
		data: unknown;
		echoText?: string;
		key?: string;
	}) => Promise<void>;
	entries: () => OutboxEntry[];
	/** Re-queues a failed entry and resumes the drain. */
	retry: (key: string) => Promise<void>;
}
