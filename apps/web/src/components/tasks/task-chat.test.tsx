// @vitest-environment jsdom
import { render } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import type { TaskRun } from "@/utils/api-types";
import { makeTaskRun, makeTaskSession } from "./task-conversation-fixtures";

// Identity stability: TaskChat re-renders on every poll of the task query (its
// parent owns the polling), so the `leading` element and `session` row it
// hands the terminal must be referentially stable across renders with
// unchanged inputs — a fresh object/element per render makes the feed's
// scroll observers re-anchor and the terminal's memoized subtree re-render
// for nothing.

const captured = vi.hoisted(() => ({
	props: [] as { leading: unknown; session: unknown }[],
}));

vi.mock("@/components/bridge/terminal", () => ({
	Terminal: (props: { leading: unknown; session: unknown }) => {
		captured.props.push(props);
		return <div data-testid="terminal-mock" />;
	},
}));

vi.mock("@/components/bridge/bridge-transport", () => ({
	createBridgeTransport: () => ({}),
}));

import { TaskChat } from "./task-chat";

it("keeps the leading element and session row referentially stable across re-renders", () => {
	captured.props.length = 0;
	const run = makeTaskRun({
		session: makeTaskSession({}),
		sessionId: "session-1",
		status: "running",
	}) as unknown as TaskRun;
	const priorRuns: TaskRun[] = [];

	const { rerender } = render(
		<TaskChat
			openingMessage="Fix the bug"
			priorRuns={priorRuns}
			run={run}
			userAvatarUrl={undefined}
		/>
	);
	rerender(
		<TaskChat
			openingMessage="Fix the bug"
			priorRuns={priorRuns}
			run={run}
			userAvatarUrl={undefined}
		/>
	);

	expect(captured.props.length).toBe(2);
	expect(captured.props[1].leading).toBe(captured.props[0].leading);
	expect(captured.props[1].session).toBe(captured.props[0].session);
});

it("passes no leading element when the opening message is empty and there are no prior runs", () => {
	captured.props.length = 0;
	const run = makeTaskRun({
		session: makeTaskSession({}),
		sessionId: "session-1",
		status: "running",
	}) as unknown as TaskRun;

	render(
		<TaskChat
			openingMessage=""
			priorRuns={[]}
			run={run}
			userAvatarUrl={undefined}
		/>
	);

	expect(captured.props.length).toBe(1);
	expect(captured.props[0].leading).toBeNull();
});
