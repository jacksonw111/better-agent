// The registry in approvals.ts is the one place double-answer, exit-then-
// answer, and invalid-optionId handling actually live — all three adapters
// (codex.ts, opencode.ts, claude-code.ts) just call through to it. Exercised
// here directly; codex.test.ts additionally covers one adapter-level
// integration of the same double-answer / exit-then-answer paths, confirming
// the protocol-level reply frame count. `presentApproval` (RC-T4's shared
// fail-closed + timeout contract, also exported from approvals.ts) has its
// own spec file, present-approval.test.ts, purely to keep both under the
// repo's 300-line file cap.

import { describe, expect, it, vi } from "vitest";
import type { NormalizedEvent } from "../normalize/types";
import { createApprovalRegistry, retractPendingApprovals } from "./approvals";
import { APPROVAL_OPTIONS, createFakeEvents } from "./approvals-test-helpers";

describe("createApprovalRegistry - double answer", () => {
	it("invokes the reply exactly once; a second answer for the same id is a no-op status warning", () => {
		const { events, pushed } = createFakeEvents();
		const registry = createApprovalRegistry(events);
		const reply = vi.fn();
		registry.register("req_1", APPROVAL_OPTIONS, reply);

		registry.answer("req_1", "allow");
		registry.answer("req_1", "allow");

		expect(reply).toHaveBeenCalledExactlyOnceWith("allow");
		expect(pushed).toEqual([
			{
				kind: "approval",
				answeredOptionId: "allow",
				options: [],
				requestId: "req_1",
				title: "Answered",
			},
			{
				kind: "status",
				status: "approval_unknown",
				detail: { requestId: "req_1" },
			},
		]);
	});
});

describe("createApprovalRegistry - resolution event", () => {
	it("pushes a persisted resolution event (answeredOptionId) before invoking the reply, so a replay can reconstruct the answered state", () => {
		const order: string[] = [];
		const pushed: NormalizedEvent[] = [];
		const events = {
			push(event: NormalizedEvent) {
				order.push("event");
				pushed.push(event);
			},
		};
		const registry = createApprovalRegistry(events);
		const reply = vi.fn(() => {
			order.push("reply");
		});
		registry.register("req_1", APPROVAL_OPTIONS, reply);

		registry.answer("req_1", "deny");

		expect(reply).toHaveBeenCalledExactlyOnceWith("deny");
		expect(pushed).toEqual([
			{
				kind: "approval",
				answeredOptionId: "deny",
				options: [],
				requestId: "req_1",
				title: "Answered",
			},
		]);
		// The resolution event lands in the stream before the reply unblocks the
		// agent, so it always precedes the turn's continuation events.
		expect(order).toEqual(["event", "reply"]);
	});
});

describe("createApprovalRegistry - exit then answer", () => {
	it("does not throw and does not reply once cleared before an answer arrives", () => {
		const { events, pushed } = createFakeEvents();
		const registry = createApprovalRegistry(events);
		const reply = vi.fn();
		registry.register("req_1", APPROVAL_OPTIONS, reply);

		registry.clear();

		expect(() => registry.answer("req_1", "allow")).not.toThrow();
		expect(reply).not.toHaveBeenCalled();
		expect(pushed).toEqual([
			{
				kind: "status",
				status: "approval_unknown",
				detail: { requestId: "req_1" },
			},
		]);
	});
});

describe("createApprovalRegistry - optionId validation", () => {
	it("reports an invalid-option status and does not reply for an optionId outside the announced options", () => {
		const { events, pushed } = createFakeEvents();
		const registry = createApprovalRegistry(events);
		const reply = vi.fn();
		registry.register("req_1", APPROVAL_OPTIONS, reply);

		registry.answer("req_1", "not-a-real-option");

		expect(reply).not.toHaveBeenCalled();
		expect(pushed).toEqual([
			{
				kind: "status",
				status: "approval_invalid_option",
				detail: { requestId: "req_1", optionId: "not-a-real-option" },
			},
		]);
	});

	it("leaves the approval pending after an invalid optionId, so a corrected answer still replies", () => {
		const { events } = createFakeEvents();
		const registry = createApprovalRegistry(events);
		const reply = vi.fn();
		registry.register("req_1", APPROVAL_OPTIONS, reply);

		registry.answer("req_1", "not-a-real-option");
		registry.answer("req_1", "allow");

		expect(reply).toHaveBeenCalledExactlyOnceWith("allow");
	});
});

describe("createApprovalRegistry - retractAll (RC-T3)", () => {
	it("drops every pending reply without invoking it, and returns their requestIds", () => {
		const { events } = createFakeEvents();
		const registry = createApprovalRegistry(events);
		const replyA = vi.fn();
		const replyB = vi.fn();
		registry.register("req_1", APPROVAL_OPTIONS, replyA);
		registry.register("req_2", APPROVAL_OPTIONS, replyB);

		const retracted = registry.retractAll();

		expect(retracted.sort()).toEqual(["req_1", "req_2"]);
		expect(replyA).not.toHaveBeenCalled();
		expect(replyB).not.toHaveBeenCalled();
	});

	it("makes a later answer() for a retracted id a no-op status warning, not a resolve", () => {
		const { events, pushed } = createFakeEvents();
		const registry = createApprovalRegistry(events);
		const reply = vi.fn();
		registry.register("req_1", APPROVAL_OPTIONS, reply);

		registry.retractAll();
		registry.answer("req_1", "allow");

		expect(reply).not.toHaveBeenCalled();
		expect(pushed).toEqual([
			{
				kind: "status",
				status: "approval_unknown",
				detail: { requestId: "req_1" },
			},
		]);
	});

	it("returns an empty list and is a no-op when nothing is pending", () => {
		const { events } = createFakeEvents();
		const registry = createApprovalRegistry(events);
		expect(registry.retractAll()).toEqual([]);
	});
});

describe("retractPendingApprovals (RC-T3)", () => {
	it("pushes a cancelled ApprovalEvent for every pending request, then leaves them un-repliable", () => {
		const { events, pushed } = createFakeEvents();
		const registry = createApprovalRegistry(events);
		const reply = vi.fn();
		registry.register("req_1", APPROVAL_OPTIONS, reply);

		retractPendingApprovals(registry, events);

		expect(pushed).toEqual([
			{
				kind: "approval",
				cancelled: true,
				options: [],
				requestId: "req_1",
				title: "Cancelled",
			},
		]);
		registry.answer("req_1", "allow");
		expect(reply).not.toHaveBeenCalled();
	});

	it("pushes nothing when there are no pending approvals", () => {
		const { events, pushed } = createFakeEvents();
		const registry = createApprovalRegistry(events);

		retractPendingApprovals(registry, events);

		expect(pushed).toEqual([]);
	});
});
