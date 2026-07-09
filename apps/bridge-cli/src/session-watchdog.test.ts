import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSessionWatchdog, STALL_MS } from "./session-watchdog";

// RC-T5: session-watchdog.ts is a pure state machine driven by the bare
// global setTimeout, so these tests use fake timers throughout (never real
// ones) — see session-watchdog.ts's own header comment for why that's safe
// here (unlike opencode-serve-http.ts's AbortSignal.timeout).
//
// Split across several `describe` blocks purely to keep each under the
// repo's max-lines-per-function gate (ESLint counts a `describe` callback's
// own body, including every nested `it`, toward that limit).

const TEST_STALL_MS = 1000;
const APPROVAL_TIMEOUT_MS = 60_000; // approvals.ts's own 5-minute timeout, scaled down for the test's own fake-timer arithmetic
const WELL_PAST_STALL_MS = 10_000;

beforeEach(() => {
	vi.useFakeTimers();
});

afterEach(() => {
	vi.useRealTimers();
});

describe("createSessionWatchdog - active turn stalling", () => {
	it("fires onStall once an active turn goes silent past stallMs", () => {
		const onStall = vi.fn();
		const watchdog = createSessionWatchdog({ onStall, stallMs: TEST_STALL_MS });

		watchdog.observeTurnStart();
		vi.advanceTimersByTime(TEST_STALL_MS - 1);
		expect(onStall).not.toHaveBeenCalled();

		vi.advanceTimersByTime(1);
		expect(onStall).toHaveBeenCalledTimes(1);
	});

	it("a turn that keeps emitting events resets the timer and never stalls", () => {
		const onStall = vi.fn();
		const watchdog = createSessionWatchdog({ onStall, stallMs: TEST_STALL_MS });
		const belowStall = 700;
		const eventCount = 5;

		watchdog.observeTurnStart();
		for (let i = 0; i < eventCount; i++) {
			vi.advanceTimersByTime(belowStall);
			watchdog.observeEvent({ kind: "message", role: "assistant", text: "…" });
		}
		expect(onStall).not.toHaveBeenCalled();

		// Only once activity truly stops does the full stallMs elapse.
		vi.advanceTimersByTime(TEST_STALL_MS);
		expect(onStall).toHaveBeenCalledTimes(1);
	});

	it("does not fire while a session hasn't started its first turn yet", () => {
		const onStall = vi.fn();
		createSessionWatchdog({ onStall, stallMs: TEST_STALL_MS });

		vi.advanceTimersByTime(WELL_PAST_STALL_MS);

		expect(onStall).not.toHaveBeenCalled();
	});

	it("defaults stallMs to STALL_MS (90s) when not overridden", () => {
		const onStall = vi.fn();
		const watchdog = createSessionWatchdog({ onStall });

		watchdog.observeTurnStart();
		vi.advanceTimersByTime(STALL_MS - 1);
		expect(onStall).not.toHaveBeenCalled();
		vi.advanceTimersByTime(1);
		expect(onStall).toHaveBeenCalledTimes(1);
	});
});

describe("createSessionWatchdog - turn-end and exit signals", () => {
	it("an idle session (turn completed, awaiting user) never stalls", () => {
		const onStall = vi.fn();
		const watchdog = createSessionWatchdog({ onStall, stallMs: TEST_STALL_MS });

		watchdog.observeTurnStart();
		watchdog.observeEvent({ kind: "status", status: "turn_usage" }); // claude-code's turn-end signal
		vi.advanceTimersByTime(WELL_PAST_STALL_MS);

		expect(onStall).not.toHaveBeenCalled();
	});

	it("an agent_exited status also stops the clock like a turn-end status", () => {
		const onStall = vi.fn();
		const watchdog = createSessionWatchdog({ onStall, stallMs: TEST_STALL_MS });

		watchdog.observeTurnStart();
		watchdog.observeEvent({ kind: "status", status: "agent_exited" });
		vi.advanceTimersByTime(WELL_PAST_STALL_MS);

		expect(onStall).not.toHaveBeenCalled();
	});
});

describe("createSessionWatchdog - approval cards pause the clock", () => {
	it("an open approval card pauses the clock until it's answered", () => {
		const onStall = vi.fn();
		const watchdog = createSessionWatchdog({ onStall, stallMs: TEST_STALL_MS });
		const halfStall = 500;

		watchdog.observeTurnStart();
		vi.advanceTimersByTime(halfStall);
		watchdog.observeEvent({
			kind: "approval",
			requestId: "req_1",
			title: "run rm -rf",
			options: [],
		});
		// The card sits open far longer than stallMs — must not fire.
		vi.advanceTimersByTime(WELL_PAST_STALL_MS);
		expect(onStall).not.toHaveBeenCalled();

		watchdog.observeApprovalAnswered();
		vi.advanceTimersByTime(TEST_STALL_MS - 1);
		expect(onStall).not.toHaveBeenCalled();
		vi.advanceTimersByTime(1);
		expect(onStall).toHaveBeenCalledTimes(1);
	});
});

describe("createSessionWatchdog - approval retraction vs. genuine timeout", () => {
	it("a retracted approval (interrupt mid-card) does not resume the clock, since the turn is already over", () => {
		const onStall = vi.fn();
		const watchdog = createSessionWatchdog({ onStall, stallMs: TEST_STALL_MS });

		watchdog.observeTurnStart();
		watchdog.observeEvent({
			kind: "approval",
			requestId: "req_1",
			title: "run rm -rf",
			options: [],
		});
		// Mirrors watchdogSink.interrupt(): observeTurnEnd() runs synchronously
		// BEFORE the interrupt's own retraction event is pushed.
		watchdog.observeTurnEnd();
		watchdog.observeEvent({
			kind: "approval",
			requestId: "req_1",
			title: "run rm -rf",
			options: [],
			cancelled: true,
		});

		vi.advanceTimersByTime(WELL_PAST_STALL_MS);
		expect(onStall).not.toHaveBeenCalled();
	});

	it("a genuine approval timeout (no interrupt) resumes the clock on its cancelled event", () => {
		const onStall = vi.fn();
		const watchdog = createSessionWatchdog({ onStall, stallMs: TEST_STALL_MS });

		watchdog.observeTurnStart();
		watchdog.observeEvent({
			kind: "approval",
			requestId: "req_1",
			title: "run rm -rf",
			options: [],
		});
		vi.advanceTimersByTime(APPROVAL_TIMEOUT_MS);
		watchdog.observeEvent({
			kind: "approval",
			requestId: "req_1",
			title: "run rm -rf",
			options: [],
			cancelled: true,
		});

		vi.advanceTimersByTime(TEST_STALL_MS - 1);
		expect(onStall).not.toHaveBeenCalled();
		vi.advanceTimersByTime(1);
		expect(onStall).toHaveBeenCalledTimes(1);
	});
});

describe("createSessionWatchdog - dispose()", () => {
	it("tears the watchdog down so it never fires again", () => {
		const onStall = vi.fn();
		const watchdog = createSessionWatchdog({ onStall, stallMs: TEST_STALL_MS });

		watchdog.observeTurnStart();
		watchdog.dispose();
		vi.advanceTimersByTime(WELL_PAST_STALL_MS);

		expect(onStall).not.toHaveBeenCalled();
	});

	it("is idempotent", () => {
		const onStall = vi.fn();
		const watchdog = createSessionWatchdog({ onStall, stallMs: TEST_STALL_MS });

		watchdog.observeTurnStart();
		watchdog.dispose();
		expect(() => watchdog.dispose()).not.toThrow();
	});
});
