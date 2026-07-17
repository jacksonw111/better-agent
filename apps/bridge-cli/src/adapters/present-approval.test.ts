// presentApproval (approvals.ts) — split out of approvals.test.ts purely to
// keep both files under the repo's 300-line file cap. See approvals.test.ts's
// header comment for what's covered there instead (the registry itself,
// retractPendingApprovals).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ApprovalEvent } from "../normalize/types";
import {
	APPROVAL_TIMEOUT_MS,
	type ApprovalRegistry,
	createApprovalRegistry,
	presentApproval,
	retractPendingApprovals,
} from "./approvals";
import { APPROVAL_OPTIONS, createFakeEvents } from "./approvals-test-helpers";

const PRESENT_APPROVAL_EVENT: ApprovalEvent = {
	kind: "approval",
	options: APPROVAL_OPTIONS,
	requestId: "req_1",
	title: "Approve action?",
};

/** fix3's timer-count assertion after arming two approvals — named so
 * eslint's no-magic-numbers doesn't flag the bare literal. */
const TWO_ARMED_TIMERS = 2;

/** Presents an approval with throwaway `vi.fn()` answer/timeout callbacks —
 * fix3's tests below only care about the timer `presentApproval` arms for
 * it, not how it resolves. Pulled out to keep each `it()` (and the
 * containing `describe`'s callback) under this file's max-lines gate. */
function presentTestApproval(
	registry: ApprovalRegistry,
	events: ReturnType<typeof createFakeEvents>["events"],
	requestId: string = PRESENT_APPROVAL_EVENT.requestId
): void {
	presentApproval({
		approvals: registry,
		event: { ...PRESENT_APPROVAL_EVENT, requestId },
		events,
		onAnswer: vi.fn(),
		onTimeout: vi.fn(),
	});
}

describe("presentApproval (RC-T4 fail-closed + timeout contract) - on-time answer", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		// R3-T2: pins Date.now() so presentApproval's stamped `timeoutAt` is a
		// deterministic value (APPROVAL_TIMEOUT_MS past epoch) instead of one
		// that floats with the real wall clock at test-run time.
		vi.setSystemTime(0);
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("pushes the card and, on an on-time answer, calls onAnswer and never times out", () => {
		const { events, pushed } = createFakeEvents();
		const registry = createApprovalRegistry(events);
		const onAnswer = vi.fn();
		const onTimeout = vi.fn();

		presentApproval({
			approvals: registry,
			event: PRESENT_APPROVAL_EVENT,
			events,
			onAnswer,
			onTimeout,
		});
		expect(pushed).toEqual([
			{
				...PRESENT_APPROVAL_EVENT,
				timeoutAt: APPROVAL_TIMEOUT_MS,
				timeoutMs: APPROVAL_TIMEOUT_MS,
			},
		]);

		registry.answer("req_1", "allow");
		vi.advanceTimersByTime(APPROVAL_TIMEOUT_MS);

		expect(onAnswer).toHaveBeenCalledExactlyOnceWith("allow");
		expect(onTimeout).not.toHaveBeenCalled();
		expect(pushed).toEqual([
			{
				...PRESENT_APPROVAL_EVENT,
				timeoutAt: APPROVAL_TIMEOUT_MS,
				timeoutMs: APPROVAL_TIMEOUT_MS,
			},
			// fix-approval-replay: the answer also persists a resolution event so
			// a later replay reconstructs the answered state — see approvals.ts's
			// `answerPending`. Crucially, NO timed-out event follows it.
			{
				kind: "approval",
				answeredOptionId: "allow",
				options: [],
				requestId: "req_1",
				title: "Answered",
			},
		]);
	});
});

describe("presentApproval (RC-T4 fail-closed + timeout contract) - timeout", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		// R3-T2: pins Date.now() so presentApproval's stamped `timeoutAt` is a
		// deterministic value (APPROVAL_TIMEOUT_MS past epoch) instead of one
		// that floats with the real wall clock at test-run time.
		vi.setSystemTime(0);
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("resolves declined with a visible event once the timeout elapses unanswered", () => {
		const { events, pushed } = createFakeEvents();
		const registry = createApprovalRegistry(events);
		const onAnswer = vi.fn();
		const onTimeout = vi.fn();

		presentApproval({
			approvals: registry,
			event: PRESENT_APPROVAL_EVENT,
			events,
			onAnswer,
			onTimeout,
		});
		vi.advanceTimersByTime(APPROVAL_TIMEOUT_MS);

		expect(onTimeout).toHaveBeenCalledOnce();
		expect(onAnswer).not.toHaveBeenCalled();
		expect(pushed).toEqual([
			{
				...PRESENT_APPROVAL_EVENT,
				timeoutAt: APPROVAL_TIMEOUT_MS,
				timeoutMs: APPROVAL_TIMEOUT_MS,
			},
			{
				kind: "approval",
				cancelled: true,
				options: [],
				requestId: "req_1",
				title: "Timed out — declined",
			},
		]);

		// A late answer after the timeout already resolved this id is a no-op,
		// not a double-resolve.
		registry.answer("req_1", "allow");
		expect(onAnswer).not.toHaveBeenCalled();
	});
});

describe("presentApproval (RC-T4 fail-closed + timeout contract) - interrupt", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		// R3-T2: pins Date.now() so presentApproval's stamped `timeoutAt` is a
		// deterministic value (APPROVAL_TIMEOUT_MS past epoch) instead of one
		// that floats with the real wall clock at test-run time.
		vi.setSystemTime(0);
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("does not double-resolve when an interrupt retracts the approval before the timeout fires", () => {
		const { events, pushed } = createFakeEvents();
		const registry = createApprovalRegistry(events);
		const onAnswer = vi.fn();
		const onTimeout = vi.fn();

		presentApproval({
			approvals: registry,
			event: PRESENT_APPROVAL_EVENT,
			events,
			onAnswer,
			onTimeout,
		});
		retractPendingApprovals(registry, events);
		vi.advanceTimersByTime(APPROVAL_TIMEOUT_MS);

		expect(onTimeout).not.toHaveBeenCalled();
		expect(onAnswer).not.toHaveBeenCalled();
		expect(pushed).toEqual([
			{
				...PRESENT_APPROVAL_EVENT,
				timeoutAt: APPROVAL_TIMEOUT_MS,
				timeoutMs: APPROVAL_TIMEOUT_MS,
			},
			{
				kind: "approval",
				cancelled: true,
				options: [],
				requestId: "req_1",
				title: "Cancelled",
			},
		]);
	});
});

describe("presentApproval (RC-T4 fail-closed + timeout contract) - fix3: retract clears the armed timer", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		// R3-T2: pins Date.now() so presentApproval's stamped `timeoutAt` is a
		// deterministic value (APPROVAL_TIMEOUT_MS past epoch) instead of one
		// that floats with the real wall clock at test-run time.
		vi.setSystemTime(0);
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("registry.retract() clears the timer instead of leaving it armed", () => {
		const { events } = createFakeEvents();
		const registry = createApprovalRegistry(events);

		presentTestApproval(registry, events);
		expect(vi.getTimerCount()).toBe(1);

		expect(registry.retract(PRESENT_APPROVAL_EVENT.requestId)).toBe(true);

		// The bug: retract() dropped the pending entry but never cleared the
		// setTimeout it was armed with, so it stayed scheduled for up to
		// APPROVAL_TIMEOUT_MS after the approval was already gone.
		expect(vi.getTimerCount()).toBe(0);
	});

	it("retractPendingApprovals (retractAll) clears every armed timer, not just the first", () => {
		const { events } = createFakeEvents();
		const registry = createApprovalRegistry(events);

		presentTestApproval(registry, events);
		presentTestApproval(registry, events, "req_2");
		expect(vi.getTimerCount()).toBe(TWO_ARMED_TIMERS);

		retractPendingApprovals(registry, events);

		expect(vi.getTimerCount()).toBe(0);
	});

	it("an on-time answer still clears the timer (unchanged behavior)", () => {
		const { events } = createFakeEvents();
		const registry = createApprovalRegistry(events);

		presentTestApproval(registry, events);
		expect(vi.getTimerCount()).toBe(1);

		registry.answer(PRESENT_APPROVAL_EVENT.requestId, "allow");

		expect(vi.getTimerCount()).toBe(0);
	});
});
