// presentApproval (approvals.ts) — split out of approvals.test.ts purely to
// keep both files under the repo's 300-line file cap. See approvals.test.ts's
// header comment for what's covered there instead (the registry itself,
// retractPendingApprovals).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ApprovalEvent } from "../normalize/types";
import {
	APPROVAL_TIMEOUT_MS,
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

describe("presentApproval (RC-T4 fail-closed + timeout contract) - on-time answer", () => {
	beforeEach(() => {
		vi.useFakeTimers();
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
		expect(pushed).toEqual([PRESENT_APPROVAL_EVENT]);

		registry.answer("req_1", "allow");
		vi.advanceTimersByTime(APPROVAL_TIMEOUT_MS);

		expect(onAnswer).toHaveBeenCalledExactlyOnceWith("allow");
		expect(onTimeout).not.toHaveBeenCalled();
		expect(pushed).toEqual([PRESENT_APPROVAL_EVENT]);
	});
});

describe("presentApproval (RC-T4 fail-closed + timeout contract) - timeout", () => {
	beforeEach(() => {
		vi.useFakeTimers();
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
			PRESENT_APPROVAL_EVENT,
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
			PRESENT_APPROVAL_EVENT,
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
