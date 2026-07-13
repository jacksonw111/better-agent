// @vitest-environment jsdom
import { fireEvent, render, within } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { BridgeChatRow } from "./bridge-chat-row";
import type { ApprovalEvent } from "./bridge-events";
import {
	extractPlanText,
	isExitPlanModeApproval,
	PlanApprovalCard,
} from "./plan-approval-card";

const PLAN_TEXT = "## The plan\n\n1. Add the card\n2. Wire the buttons";

/** The chosen button's accessible name gains the sr-only "(chosen)" suffix —
 * match on the label prefix (top-level per lint/performance/useTopLevelRegex). */
const REVISE_NAME = /^Revise/;

const PLAN_EVENT: ApprovalEvent = {
	detail: JSON.stringify({ plan: PLAN_TEXT }),
	kind: "approval",
	options: [
		{ id: "allow", label: "Allow" },
		{ id: "deny", label: "Deny" },
	],
	requestId: "req_plan",
	title: "Use ExitPlanMode?",
};

it("detects ExitPlanMode approvals by the adapter's title, nothing else", () => {
	expect(isExitPlanModeApproval(PLAN_EVENT)).toBe(true);
	expect(isExitPlanModeApproval({ ...PLAN_EVENT, title: "Use Bash?" })).toBe(
		false
	);
});

it("extracts the plan markdown from the JSON detail, null when malformed", () => {
	expect(extractPlanText(PLAN_EVENT.detail)).toBe(PLAN_TEXT);
	expect(extractPlanText(undefined)).toBeNull();
	expect(extractPlanText("not json")).toBeNull();
	expect(extractPlanText(JSON.stringify({ plan: "   " }))).toBeNull();
	expect(extractPlanText(JSON.stringify({ other: 1 }))).toBeNull();
});

it("renders the plan as markdown with Build mapping to allow and Revise to deny", () => {
	const onAnswer = vi.fn();
	const { container } = render(
		<PlanApprovalCard event={PLAN_EVENT} onAnswer={onAnswer} />
	);
	const view = within(container);
	expect(view.getByText("Ready to build?")).toBeDefined();
	expect(view.getByText("Add the card")).toBeDefined();

	fireEvent.click(view.getByRole("button", { name: "Build" }));
	expect(onAnswer).toHaveBeenCalledWith("req_plan", "allow");
	fireEvent.click(view.getByRole("button", { name: "Revise" }));
	expect(onAnswer).toHaveBeenCalledWith("req_plan", "deny");
});

it("degrades to the bare Ready-to-build prompt when the detail carries no plan text", () => {
	const onAnswer = vi.fn();
	const { container } = render(
		<PlanApprovalCard
			event={{ ...PLAN_EVENT, detail: undefined }}
			onAnswer={onAnswer}
		/>
	);
	const view = within(container);
	expect(view.getByText("Ready to build?")).toBeDefined();
	fireEvent.click(view.getByRole("button", { name: "Build" }));
	expect(onAnswer).toHaveBeenCalledExactlyOnceWith("req_plan", "allow");
});

it("answers Build on ⌘/Ctrl+Enter while pending, and goes inert once answered", () => {
	const onAnswer = vi.fn();
	const { rerender } = render(
		<PlanApprovalCard event={PLAN_EVENT} onAnswer={onAnswer} />
	);
	fireEvent.keyDown(document, { key: "Enter" });
	expect(onAnswer).not.toHaveBeenCalled();
	fireEvent.keyDown(document, { key: "Enter", metaKey: true });
	expect(onAnswer).toHaveBeenCalledExactlyOnceWith("req_plan", "allow");

	rerender(
		<PlanApprovalCard
			answeredOptionId="allow"
			event={PLAN_EVENT}
			onAnswer={onAnswer}
		/>
	);
	fireEvent.keyDown(document, { key: "Enter", ctrlKey: true });
	expect(onAnswer).toHaveBeenCalledTimes(1);
});

it("disables both buttons and marks the chosen one once answered, countdown while pending", () => {
	const timedEvent: ApprovalEvent = {
		...PLAN_EVENT,
		timeoutAt: Date.now() + 60_000,
		timeoutMs: 300_000,
	};
	const { container, rerender } = render(
		<PlanApprovalCard event={timedEvent} />
	);
	expect(
		container.querySelector('[data-slot="approval-countdown"]')
	).not.toBeNull();

	rerender(<PlanApprovalCard answeredOptionId="deny" event={timedEvent} />);
	expect(
		container.querySelector('[data-slot="approval-countdown"]')
	).toBeNull();
	const view = within(container);
	const revise = view.getByRole("button", {
		name: REVISE_NAME,
	}) as HTMLButtonElement;
	expect(revise.disabled).toBe(true);
	expect(revise.textContent).toContain("(chosen)");
	expect(
		(view.getByRole("button", { name: "Build" }) as HTMLButtonElement).disabled
	).toBe(true);
});

it("routes an ExitPlanMode approval turn to the plan card, others to the generic line", () => {
	const noop = () => {
		// no-op for this test
	};
	const renderTurn = (event: ApprovalEvent) =>
		render(
			<BridgeChatRow
				answered={{}}
				answeredQuestions={{}}
				ended={false}
				onAnswerApproval={noop}
				onAnswerQuestion={noop}
				turn={{ event, id: 1, kind: "approval" }}
			/>
		).container;

	const planContainer = renderTurn(PLAN_EVENT);
	expect(within(planContainer).getByText("Ready to build?")).toBeDefined();

	const genericContainer = renderTurn({
		...PLAN_EVENT,
		detail: '{"command":"ls"}',
		title: "Use Bash?",
	});
	const genericView = within(genericContainer);
	expect(genericView.getByText("Use Bash?")).toBeDefined();
	expect(genericView.queryByText("Ready to build?")).toBeNull();
});
