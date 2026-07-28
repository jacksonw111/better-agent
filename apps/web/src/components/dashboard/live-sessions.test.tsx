// @vitest-environment jsdom
import { fireEvent, render, within } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { type LiveSessionRow, LiveSessionsView } from "./live-sessions";

const STUDIO = /Studio/;
const STATUS_UNKNOWN = /Status unknown/i;
const NO_BACKGROUND = /No background sessions/i;

function row(overrides: Partial<LiveSessionRow>): LiveSessionRow {
	return {
		activityState: "working",
		activityStateAt: new Date("2026-07-28T12:00:00Z"),
		agentKind: "claude-code",
		computerId: "comp-1",
		computerName: "MacBook",
		lastActivityAt: new Date("2026-07-28T12:00:00Z"),
		projectId: null,
		sessionId: "sess-1",
		title: "Session 7/28 12:00",
		...overrides,
	};
}

it("renders a row per session with its state and computer", () => {
	const rows = [
		row({ sessionId: "a", title: "Refactor", activityState: "working" }),
		row({
			sessionId: "b",
			title: "Docs",
			activityState: "idle",
			computerName: "Studio",
		}),
	];
	const { container } = render(
		<LiveSessionsView isPending={false} onOpen={vi.fn()} rows={rows} />
	);
	const view = within(container);
	expect(view.getByText("Refactor")).toBeDefined();
	expect(view.getByText("Docs")).toBeDefined();
	expect(view.getByText("Working")).toBeDefined();
	expect(view.getByText("Idle")).toBeDefined();
	expect(view.getByText(STUDIO)).toBeDefined();
});

it("reattaches the clicked session's computer + id", () => {
	const onOpen = vi.fn();
	const { container } = render(
		<LiveSessionsView
			isPending={false}
			onOpen={onOpen}
			rows={[row({ sessionId: "sess-9", computerId: "comp-9", title: "Go" })]}
		/>
	);
	fireEvent.click(within(container).getByText("Go"));
	expect(onOpen).toHaveBeenCalledWith("comp-9", "sess-9");
});

it("tolerates a null activity_state without throwing", () => {
	const { container } = render(
		<LiveSessionsView
			isPending={false}
			onOpen={vi.fn()}
			rows={[row({ activityState: null, activityStateAt: null, title: "Old" })]}
		/>
	);
	expect(within(container).getByText("Old")).toBeDefined();
	expect(within(container).getByText(STATUS_UNKNOWN)).toBeDefined();
});

it("shows an empty hint when there are no sessions", () => {
	const { container } = render(
		<LiveSessionsView isPending={false} onOpen={vi.fn()} rows={[]} />
	);
	expect(within(container).getByText(NO_BACKGROUND)).toBeDefined();
});

it("shows skeletons while pending", () => {
	const { container } = render(
		<LiveSessionsView isPending={true} onOpen={vi.fn()} rows={[]} />
	);
	expect(within(container).queryByText(NO_BACKGROUND)).toBeNull();
});
