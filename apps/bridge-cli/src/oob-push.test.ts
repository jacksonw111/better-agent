import { describe, expect, it, vi } from "vitest";
import { createOobSender } from "./oob-push";
import type { Sleep } from "./push-queue";

// A1 (event-loss audit): every out-of-band push site (shell runner, image
// status, watchdog stalled marker, task-start echo, session-end status) used
// to be a single fire-and-forget `pushEvents(...).catch(() => undefined)` —
// no retry, no idempotency key, silently swallowed errors. `createOobSender`
// gives them all one shared reliable channel built on the same retry queue
// the main event stream uses.

const instantSleep: Sleep = () => Promise.resolve();
const EPOCH = 1234;

function baseOptions(pushEvents: (input: unknown) => Promise<void>) {
	return {
		epoch: EPOCH,
		log: vi.fn(),
		onWarning: vi.fn(),
		pushEvents,
		sessionId: "sess_1",
		sleep: instantSleep,
	};
}

async function deliversWithAnOobIdempotencyKeyAndLogs(): Promise<void> {
	const pushEvents = vi.fn(() => Promise.resolve());
	const options = baseOptions(pushEvents);
	const sender = createOobSender(options);

	sender.push("shell", { kind: "tool", name: "shell" });
	sender.push("watchdog", { kind: "status", status: "stalled" });
	await sender.close();

	expect(pushEvents).toHaveBeenNthCalledWith(1, {
		events: [{ kind: "tool", name: "shell" }],
		idempotencyKeys: [`oob:${EPOCH}:1`],
		sessionId: "sess_1",
	});
	expect(pushEvents).toHaveBeenNthCalledWith(2, {
		events: [{ kind: "status", status: "stalled" }],
		idempotencyKeys: [`oob:${EPOCH}:2`],
		sessionId: "sess_1",
	});
	expect(options.log.mock.calls.map((call) => call[0])).toEqual([
		"cli.emit.oob source=shell",
		"cli.emit.oob source=watchdog",
	]);
}

async function retriesAFailedPushWithAStableKey(): Promise<void> {
	let attempts = 0;
	const pushEvents = vi.fn((_input: unknown): Promise<void> => {
		attempts += 1;
		return attempts === 1
			? Promise.reject(new Error("network blip"))
			: Promise.resolve();
	});
	const sender = createOobSender(baseOptions(pushEvents));

	sender.push("image", { kind: "status", status: "image_failed" });
	await sender.close();

	expect(attempts).toBe(2);
	// The resend reuses the exact same idempotency key, so the relay can dedup
	// a retry whose ack was lost.
	expect(pushEvents.mock.calls[0]?.[0]).toEqual(pushEvents.mock.calls[1]?.[0]);
}

async function warnsInsteadOfStayingSilentOnPermanentFailure(): Promise<void> {
	const pushEvents = vi.fn(() => Promise.reject(new Error("token revoked")));
	const options = baseOptions(pushEvents);
	const sender = createOobSender(options);

	sender.push("outcome", { kind: "status", status: "stopped_by_server" });
	await sender.close();

	expect(options.onWarning).toHaveBeenCalledWith(
		expect.stringContaining("out-of-band push channel failed permanently")
	);

	// A push after the channel died is warned about too — never silent.
	sender.push("shell", { kind: "tool" });
	expect(options.onWarning).toHaveBeenCalledWith(
		expect.stringContaining("dropped out-of-band shell event")
	);
}

async function closeFlushesEverythingStillPending(): Promise<void> {
	const release = Promise.withResolvers<void>();
	const delivered: unknown[] = [];
	const pushEvents = vi.fn(async (input: unknown): Promise<void> => {
		await release.promise;
		delivered.push(input);
	});
	const sender = createOobSender(baseOptions(pushEvents));

	sender.push("taskstart", { kind: "message", text: "ctx" });
	sender.push("taskstart", { kind: "status", status: "resume_failed" });
	release.resolve();
	await sender.close();

	expect(delivered).toHaveLength(2);
}

async function closeResolvesWithAWarningWhenTheFlushTimesOut(): Promise<void> {
	const pushEvents = vi.fn(() => new Promise<void>(() => undefined)); // hangs
	const options = { ...baseOptions(pushEvents), closeTimeoutMs: 5 };
	const sender = createOobSender(options);

	sender.push("shell", { kind: "tool" });
	await sender.close(); // must not hang forever

	expect(options.onWarning).toHaveBeenCalledWith(
		expect.stringContaining("flush timed out")
	);
}

describe("createOobSender", () => {
	it(
		"delivers each event with an oob idempotency key and logs cli.emit.oob",
		deliversWithAnOobIdempotencyKeyAndLogs
	);

	it(
		"retries a failed push, reusing the same idempotency key",
		retriesAFailedPushWithAStableKey
	);

	it(
		"warns (never silently swallows) when the push channel permanently fails",
		warnsInsteadOfStayingSilentOnPermanentFailure
	);

	it(
		"close() flushes everything still pending",
		closeFlushesEverythingStillPending
	);

	it(
		"close() resolves with a warning instead of hanging when the flush times out",
		closeResolvesWithAWarningWhenTheFlushTimesOut
	);
});
