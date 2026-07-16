// @vitest-environment jsdom
// S3-T2 (master spec §10/§11): the Task Start Context is injected by the CLI
// as an `origin: "task-start"` user message (see
// apps/bridge-cli/src/task-launch/run-session.ts). The fold carries the tag
// onto the user turn, and the chat row renders it COLLAPSED by default — one
// line, expandable — so the agent-facing context never masquerades as
// something the user typed. Split from bridge-turns.test.ts for the repo's
// 300-line file cap.

import { cleanup, fireEvent, render, within } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { BridgeChatRow } from "./bridge-chat-row";
import type { StreamEvent } from "./bridge-events";
import { foldEventsToTurns } from "./bridge-turns";

const ev = (id: number, event: StreamEvent["event"]): StreamEvent => ({
	id,
	event,
});

const CONTEXT_TEXT = "Fix the login bug with /tdd\n\n## Execution context";
const EXECUTION_CONTEXT_PATTERN = /Execution context/;
const SKILL_PATTERN = /\/tdd/;

afterEach(cleanup);

it("carries origin: task-start from the message event onto the user turn", () => {
	const turns = foldEventsToTurns([
		ev(1, {
			kind: "message",
			origin: "task-start",
			role: "user",
			text: CONTEXT_TEXT,
		}),
	]);
	expect(turns).toEqual([
		{ id: 1, kind: "user", origin: "task-start", text: CONTEXT_TEXT },
	]);
});

it("leaves an ordinary user message untagged", () => {
	const turns = foldEventsToTurns([
		ev(1, { kind: "message", role: "user", text: "hello" }),
	]);
	expect(turns).toEqual([{ id: 1, kind: "user", text: "hello" }]);
});

it("renders a task-start turn collapsed to one line, expandable to the full context", () => {
	const [turn] = foldEventsToTurns([
		ev(1, {
			kind: "message",
			origin: "task-start",
			role: "user",
			text: CONTEXT_TEXT,
		}),
	]);
	const { container } = render(
		<BridgeChatRow
			answered={{}}
			answeredQuestions={{}}
			ended={false}
			onAnswerApproval={() => undefined}
			onAnswerQuestion={() => undefined}
			turn={turn}
		/>
	);
	const view = within(container);

	// Collapsed: the one-line summary shows, the context body does not.
	const toggle = view.getByRole("button", {
		name: "Task start context sent to agent",
	});
	expect(view.queryByText(EXECUTION_CONTEXT_PATTERN)).toBeNull();

	fireEvent.click(toggle);
	expect(view.getByText(EXECUTION_CONTEXT_PATTERN)).toBeDefined();
	// The /skill reference stays verbatim inside the expanded context.
	expect(view.getByText(SKILL_PATTERN)).toBeDefined();

	fireEvent.click(toggle);
	expect(view.queryByText(EXECUTION_CONTEXT_PATTERN)).toBeNull();
});

it("renders an ordinary user turn as a plain bubble, not a disclosure", () => {
	const [turn] = foldEventsToTurns([
		ev(1, { kind: "message", role: "user", text: "just a question" }),
	]);
	const { container } = render(
		<BridgeChatRow
			answered={{}}
			answeredQuestions={{}}
			ended={false}
			onAnswerApproval={() => undefined}
			onAnswerQuestion={() => undefined}
			turn={turn}
		/>
	);
	const view = within(container);
	expect(view.getByText("just a question")).toBeDefined();
	expect(
		view.queryByRole("button", { name: "Task start context sent to agent" })
	).toBeNull();
});
