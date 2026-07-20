import { expect, it, vi } from "vitest";
import {
	createSendOutbox,
	MAX_SEND_ATTEMPTS,
	retryDelayMs,
	SEND_RETRY_BASE_MS,
	SEND_RETRY_MAX_MS,
} from "./send-outbox";
import { loadOutbox, outboxStorageKey } from "./send-outbox-storage";
import type { SendOutboxOptions } from "./send-outbox-types";

const SESSION_ID = "session-1";

/** Yields to the macrotask queue so the outbox's chained drain (see `drain`)
 * has actually started its first send before a test inspects it. */
function flush(): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, 0));
}

/** A Map-backed `Storage` stand-in — the outbox tests run under the default
 * `node` environment (no real `sessionStorage`), and injecting one keeps the
 * persistence assertions independent of the DOM shim. */
function fakeStorage(seed?: Record<string, string>): Storage {
	const map = new Map<string, string>(Object.entries(seed ?? {}));
	return {
		get length() {
			return map.size;
		},
		clear: () => map.clear(),
		getItem: (key: string) => map.get(key) ?? null,
		key: (index: number) => [...map.keys()][index] ?? null,
		removeItem: (key: string) => map.delete(key),
		setItem: (key: string, value: string) => map.set(key, value),
	} as Storage;
}

/** An outbox whose retry sleeps resolve immediately, so a test can drive six
 * attempts without waiting out the real backoff — the delays themselves are
 * asserted separately against `retryDelayMs`. */
function buildOutbox(overrides: Partial<SendOutboxOptions> = {}) {
	const sleeps: number[] = [];
	const statuses: { key: string; status: string }[] = [];
	const storage = overrides.storage ?? fakeStorage();
	const outbox = createSendOutbox({
		makeKey: (() => {
			let next = 0;
			return () => {
				next += 1;
				return `key-${next}`;
			};
		})(),
		onStatus: (key, status) => statuses.push({ key, status }),
		send: () => Promise.resolve(),
		sessionId: SESSION_ID,
		sleep: (ms: number) => {
			sleeps.push(ms);
			return Promise.resolve();
		},
		storage,
		...overrides,
	});
	return { outbox, sleeps, statuses, storage };
}

it("backs off exponentially from the base delay up to the cap", () => {
	expect(retryDelayMs(1)).toBe(SEND_RETRY_BASE_MS);
	expect(retryDelayMs(2)).toBe(SEND_RETRY_BASE_MS * 2);
	expect(retryDelayMs(3)).toBe(SEND_RETRY_BASE_MS * 4);
	expect(retryDelayMs(MAX_SEND_ATTEMPTS)).toBe(SEND_RETRY_MAX_MS);
	expect(retryDelayMs(99)).toBe(SEND_RETRY_MAX_MS);
});

it("retries a failed send until it succeeds, then clears the entry", async () => {
	const send = vi
		.fn<(args: { data: unknown; idempotencyKey: string }) => Promise<void>>()
		.mockRejectedValueOnce(new Error("offline"))
		.mockRejectedValueOnce(new Error("offline"))
		.mockResolvedValue(undefined);
	const { outbox, sleeps, statuses } = buildOutbox({ send });

	await outbox.enqueue({ data: "hi", echoText: "hi" });

	expect(send).toHaveBeenCalledTimes(3);
	expect(sleeps).toEqual([retryDelayMs(1), retryDelayMs(2)]);
	expect(outbox.entries()).toEqual([]);
	expect(statuses.at(-1)).toEqual({ key: "key-1", status: "sent" });
});

it("keeps the SAME idempotency key across every retry of one message", async () => {
	const seen: string[] = [];
	const send = vi.fn((args: { data: unknown; idempotencyKey: string }) => {
		seen.push(args.idempotencyKey);
		return seen.length < 3
			? Promise.reject(new Error("offline"))
			: Promise.resolve();
	});
	const { outbox } = buildOutbox({ send });

	await outbox.enqueue({ data: "hi", echoText: "hi" });

	expect(seen).toEqual(["key-1", "key-1", "key-1"]);
});

it("gives up after MAX_SEND_ATTEMPTS and marks the chat entry failed", async () => {
	const send = vi.fn(() => Promise.reject(new Error("offline")));
	const { outbox, statuses } = buildOutbox({ send });

	await outbox.enqueue({ data: "hi", echoText: "hi" });

	expect(send).toHaveBeenCalledTimes(MAX_SEND_ATTEMPTS);
	expect(outbox.entries()).toMatchObject([
		{ attempts: MAX_SEND_ATTEMPTS, key: "key-1", status: "failed" },
	]);
	expect(statuses.at(-1)).toEqual({ key: "key-1", status: "failed" });
});

it("resends a failed entry on manual retry and settles it", async () => {
	let failing = true;
	const send = vi.fn(() =>
		failing ? Promise.reject(new Error("offline")) : Promise.resolve()
	);
	const { outbox } = buildOutbox({ send });
	await outbox.enqueue({ data: "hi", echoText: "hi" });
	expect(outbox.entries()).toHaveLength(1);

	failing = false;
	await outbox.retry("key-1");

	expect(outbox.entries()).toEqual([]);
});

it("drops a failed entry on discard", async () => {
	const send = vi.fn(() => Promise.reject(new Error("offline")));
	const { outbox, statuses } = buildOutbox({ send });
	await outbox.enqueue({ data: "hi", echoText: "hi" });

	outbox.discard("key-1");

	expect(outbox.entries()).toEqual([]);
	expect(statuses.at(-1)).toEqual({ key: "key-1", status: "discarded" });
});

it("sends serially, in enqueue order, even when the first send is slow", async () => {
	const order: unknown[] = [];
	let releaseFirst: (() => void) | undefined;
	const send = vi.fn((args: { data: unknown }) => {
		order.push(args.data);
		if (args.data === "first") {
			return new Promise<void>((resolve) => {
				releaseFirst = resolve;
			});
		}
		return Promise.resolve();
	});
	const { outbox } = buildOutbox({ send });

	const firstDone = outbox.enqueue({ data: "first", echoText: "first" });
	const secondDone = outbox.enqueue({ data: "second", echoText: "second" });
	await flush();
	// The second send must NOT have started while the first is still in flight.
	expect(order).toEqual(["first"]);

	releaseFirst?.();
	await Promise.all([firstDone, secondDone]);

	expect(order).toEqual(["first", "second"]);
});

it("persists queued entries to storage and drops them once delivered", async () => {
	let release: (() => void) | undefined;
	const send = vi.fn(
		() =>
			new Promise<void>((resolve) => {
				release = resolve;
			})
	);
	const { outbox, storage } = buildOutbox({ send });

	const done = outbox.enqueue({ data: "hi", echoText: "hi" });
	await flush();
	expect(loadOutbox(SESSION_ID, storage)).toMatchObject([{ key: "key-1" }]);

	release?.();
	await done;

	expect(storage.getItem(outboxStorageKey(SESSION_ID))).toBeNull();
});

it("restores a persisted outbox after a reload and keeps trying", async () => {
	const storage = fakeStorage();
	const stalled = createSendOutbox({
		send: () => new Promise<void>(() => undefined),
		sessionId: SESSION_ID,
		storage,
	});
	stalled.enqueue({ data: "hi", echoText: "hi" }).catch(() => undefined);
	await flush();
	expect(stalled.entries()).toHaveLength(1);

	// A page reload: a brand-new outbox over the SAME session's storage.
	const send = vi.fn(() => Promise.resolve());
	const { outbox } = buildOutbox({ send, storage });
	expect(outbox.entries()).toMatchObject([
		{ echoText: "hi", status: "queued" },
	]);

	await outbox.drain();

	expect(send).toHaveBeenCalledTimes(1);
	expect(outbox.entries()).toEqual([]);
});

it("rejects a control command's promise when it finally fails, and unblocks the queue", async () => {
	const send = vi.fn((args: { data: unknown }) =>
		args.data === "control"
			? Promise.reject(new Error("offline"))
			: Promise.resolve()
	);
	const { outbox } = buildOutbox({ send });

	const controlDone = outbox.enqueue({ data: "control" });
	const chatDone = outbox.enqueue({ data: "chat", echoText: "chat" });

	await expect(controlDone).rejects.toThrow("offline");
	await chatDone;
	// The exhausted control command is NOT parked in the outbox (its rejection
	// already told the caller), so the chat message behind it still went out.
	expect(outbox.entries()).toEqual([]);
});

it("never rejects a chat send: a final failure surfaces as the failed entry instead", async () => {
	const send = vi.fn(() => Promise.reject(new Error("offline")));
	const { outbox } = buildOutbox({ send });

	await expect(
		outbox.enqueue({ data: "hi", echoText: "hi" })
	).resolves.toBeUndefined();
	expect(outbox.entries()).toMatchObject([{ status: "failed" }]);
});

it("ignores a corrupt persisted outbox instead of throwing", () => {
	const storage = fakeStorage({ [outboxStorageKey(SESSION_ID)]: "{not json" });
	expect(loadOutbox(SESSION_ID, storage)).toEqual([]);
});
