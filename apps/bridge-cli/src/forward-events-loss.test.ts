import { describe, expect, it, vi } from "vitest";
import { forwardEvents, type QueuedEvent } from "./forward-events";

// A2/A4 (event-loss audit): forwardEvents' push backlog must shed ONLY
// streamed text deltas (kind: "output") under cap pressure — final messages,
// approvals, and status events are protected — and must leave a visible
// `event_truncated`-style marker where deltas were elided. It also emits an
// always-on `cli.emit` instrumentation line on every flush so a lossy
// session can be diagnosed from the CLI's stderr alone.

const NEVER_FLUSH = () => new Promise<void>(() => undefined);
const GENERATION = 7;

function protectedMessage(text: string): unknown {
	return { kind: "message", role: "assistant", text };
}

function delta(text: string): unknown {
	return { kind: "output", text };
}

/** Blocks the first push in flight while the source feeds three more events
 * past the cap, recording every pushed batch. */
function overflowRig() {
	const firstPushStarted = Promise.withResolvers<void>();
	const releaseFirstPush = Promise.withResolvers<void>();
	const allFed = Promise.withResolvers<void>();
	const batches: QueuedEvent<unknown>[][] = [];
	const push = vi.fn(async (batch: QueuedEvent<unknown>[]): Promise<void> => {
		batches.push(batch);
		if (batches.length === 1) {
			firstPushStarted.resolve();
			await releaseFirstPush.promise;
		}
	});
	async function* source(): AsyncGenerator<unknown> {
		yield protectedMessage("m0");
		await firstPushStarted.promise; // m0 is in flight; the rest backlogs
		yield delta("d1");
		yield delta("d2");
		yield protectedMessage("m1"); // backlog hits 3 > cap 2 -> sheds d1
		allFed.resolve();
	}
	return { allFed, batches, push, releaseFirstPush, source };
}

async function shedsOnlyDeltasAndDeliversAMarker(): Promise<void> {
	const { allFed, batches, push, releaseFirstPush, source } = overflowRig();
	const onWarning = vi.fn();

	const done = forwardEvents(source(), push, {
		generationId: GENERATION,
		maxBatchSize: 1,
		maxBufferedEvents: 2,
		onWarning,
		sleep: NEVER_FLUSH,
	});
	await allFed.promise;
	releaseFirstPush.resolve();
	await done;

	const events = batches.flat().map((item) => item.event);
	expect(events).toEqual([
		protectedMessage("m0"),
		{
			detail: {
				droppedEvents: 1,
				originalKind: "output",
				reason: "push_backlog_overflow",
			},
			kind: "status",
			status: "event_truncated",
		},
		delta("d2"),
		protectedMessage("m1"),
	]);
	// The marker gets its own generation-salted idempotency key, distinct from
	// the ordinary per-event counter keys.
	const marker = batches
		.flat()
		.find(
			(item) => (item.event as { status?: string }).status === "event_truncated"
		);
	expect(marker?.idempotencyKey).toBe(`${GENERATION}:shed:1`);
	expect(onWarning).toHaveBeenCalledWith(
		expect.stringContaining("dropped 1 buffered delta event(s)")
	);
}

async function logsAnEmitLineOnEveryFlush(): Promise<void> {
	async function* source(): AsyncGenerator<unknown> {
		await Promise.resolve();
		yield delta("a");
		yield delta("b");
	}
	const log = vi.fn();

	await forwardEvents(source(), () => Promise.resolve(), {
		generationId: 3,
		log,
		maxBatchSize: 100,
		sleep: NEVER_FLUSH,
	});

	// The leading-edge flush ships event 1 alone; the trailing flush ships the
	// rest — each flush logs the cumulative per-generation emitted count.
	expect(log.mock.calls.map((call) => call[0])).toEqual([
		"cli.emit gen=3 emitted=1",
		"cli.emit gen=3 emitted=2",
	]);
}

describe("forwardEvents - class-aware backlog shedding", () => {
	it(
		"sheds only output deltas under cap pressure and delivers an event_truncated marker",
		shedsOnlyDeltasAndDeliversAMarker
	);
});

describe("forwardEvents - cli.emit instrumentation", () => {
	it(
		"logs the cumulative emitted count on every flush",
		logsAnEmitLineOnEveryFlush
	);
});
