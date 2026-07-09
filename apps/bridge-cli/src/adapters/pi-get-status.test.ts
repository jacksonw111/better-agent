// `piAdapter`'s getStatus timeout behavior (makePiStatusTracker in pi.ts) —
// split out of pi.test.ts purely to keep that file under the repo's 300-line
// limit, the same way pi.runtime.test.ts already splits off other pi.ts
// specs. Duplicates `createFakeProcessIo` for the same reason those other
// files do: `vi.mock` hoisting is per-spec-file, so each file needs its own.

import { describe, expect, it, vi } from "vitest";
import { createAsyncQueue } from "./async-queue";
import { piAdapter } from "./pi";
import type { ProcessExitInfo, ProcessIo } from "./process-io";
import { spawnProcessIo } from "./process-io";

vi.mock("./process-io", () => ({ spawnProcessIo: vi.fn() }));

/** An async iterable that never yields — stands in for stdout/stderr on a
 * process that's still running. */
const neverEndingLines: AsyncIterable<string> = {
	[Symbol.asyncIterator]() {
		return {
			next: () => new Promise<IteratorResult<string>>(() => undefined),
		};
	},
};

/** A fake `ProcessIo` whose exit can be triggered, and whose stdout lines can
 * be fed, on demand by the test, standing in for the real `pi --mode rpc`
 * child process pi.ts spawns. */
function createFakeProcessIo(): {
	io: ProcessIo;
	pushLine(line: string): void;
	triggerExit(info: ProcessExitInfo): void;
} {
	const exitHandlers: Array<(info: ProcessExitInfo) => void> = [];
	const lines = createAsyncQueue<string>();
	return {
		io: {
			child: {} as ProcessIo["child"],
			lines,
			onExit: (handler) => exitHandlers.push(handler),
			stderrLines: neverEndingLines,
			stop: vi.fn(),
			writeLine: vi.fn(),
		},
		pushLine(line: string): void {
			lines.push(line);
		},
		triggerExit(info: ProcessExitInfo): void {
			for (const handler of exitHandlers) {
				handler(info);
			}
		},
	};
}

// Mirrors pi.ts's own STATUS_TIMEOUT_MS (makePiStatusTracker) — kept as a
// separate constant here so this spec doesn't import an internal from the
// module under test.
const PI_STATUS_TIMEOUT_MS = 4000;

/** Starts a pi adapter under fake timers and fires one `getStatus()` that pi
 * never replies to, advancing past `PI_STATUS_TIMEOUT_MS` so the timeout
 * fallback fires. Shared by both getStatus-timeout tests below purely to keep
 * each `it()` under the line gate. */
async function startAndTimeOutOneStatusRequest(): Promise<{
	event: unknown;
	handle: Awaited<ReturnType<typeof piAdapter.start>>;
	iterator: AsyncIterator<unknown>;
	pushLine(line: string): void;
}> {
	const { io, pushLine } = createFakeProcessIo();
	vi.mocked(spawnProcessIo).mockResolvedValue(io);

	const handle = await piAdapter.start("/tmp/project");
	const iterator = handle.events[Symbol.asyncIterator]();

	handle.getStatus?.();
	const timedOut = iterator.next();
	await vi.advanceTimersByTimeAsync(PI_STATUS_TIMEOUT_MS);
	const { value: event } = await timedOut;

	return { event, handle, iterator, pushLine };
}

/** Runs `fn` under fake timers, guaranteeing `vi.useRealTimers()` afterwards
 * even on failure — shared by the getStatus-timeout tests below purely to
 * keep each `it()` under the line gate. */
async function withFakeTimers<T>(fn: () => Promise<T>): Promise<T> {
	vi.useFakeTimers();
	try {
		return await fn();
	} finally {
		vi.useRealTimers();
	}
}

describe("piAdapter - getStatus timeout", () => {
	it("pushes a status_snapshot with whatever's known once pi never replies in time", () =>
		withFakeTimers(async () => {
			const { event } = await startAndTimeOutOneStatusRequest();

			expect(event).toEqual({
				kind: "status",
				status: "status_snapshot",
				detail: { model: undefined, running: undefined },
				turnEpoch: 0,
			});
		}));
});

describe("piAdapter - getStatus timeout - pending clears", () => {
	it("doesn't push a stray extra snapshot for a reply that arrives after the timeout", () =>
		withFakeTimers(async () => {
			const { iterator, pushLine } = await startAndTimeOutOneStatusRequest();

			pushLine(
				JSON.stringify({
					type: "response",
					command: "get_session_stats",
					success: true,
					data: { tokens: { input: 1, output: 2 }, cost: 0 },
				})
			);
			pushLine(
				JSON.stringify({
					type: "response",
					command: "get_state",
					success: true,
					data: { model: { id: "late" }, isStreaming: false },
				})
			);
			// An unrelated event pushed right after: if the late replies above had
			// produced a stray snapshot, it would be the next event, not this one.
			pushLine(
				JSON.stringify({
					type: "message_end",
					message: { role: "assistant", content: "after timeout" },
				})
			);

			const { value: afterLateReply } = await iterator.next();
			expect(afterLateReply).toEqual({
				kind: "message",
				role: "assistant",
				text: "after timeout",
				turnEpoch: 0,
			});
		}));
});

describe("piAdapter - getStatus timeout - recovery", () => {
	it("still resolves normally on a fresh request() after a previous one timed out", () =>
		withFakeTimers(async () => {
			const { handle, iterator, pushLine } =
				await startAndTimeOutOneStatusRequest();

			handle.getStatus?.();
			pushLine(
				JSON.stringify({
					type: "response",
					command: "get_session_stats",
					success: true,
					data: { tokens: { input: 3, output: 4 }, cost: 0.01 },
				})
			);
			pushLine(
				JSON.stringify({
					type: "response",
					command: "get_state",
					success: true,
					data: {
						model: { id: "claude-sonnet-4-20250514" },
						isStreaming: true,
					},
				})
			);

			const { value: freshEvent } = await iterator.next();
			expect(freshEvent).toEqual({
				kind: "status",
				status: "status_snapshot",
				detail: {
					model: "claude-sonnet-4-20250514",
					running: true,
					tokens: {
						input: 3,
						output: 4,
						cacheRead: undefined,
						cacheWrite: undefined,
					},
					costUsd: 0.01,
					contextUsage: undefined,
				},
				turnEpoch: 0,
			});
		}));
});
