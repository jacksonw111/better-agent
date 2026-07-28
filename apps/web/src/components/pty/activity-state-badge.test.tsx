// @vitest-environment jsdom
import { render, within } from "@testing-library/react";
import { expect, it } from "vitest";
import { ActivityDot, ActivityStateBadge } from "./activity-state-badge";

const WORKING = /Working/i;
const IDLE = /Idle/i;
const STARTING = /Starting/i;
const ENDED = /Ended/i;
const UNKNOWN = /Status unknown/i;

const CASES: [string, RegExp][] = [
	["working", WORKING],
	["idle", IDLE],
	["starting", STARTING],
	["ended", ENDED],
];

it("labels each known state on the badge", () => {
	for (const [state, label] of CASES) {
		const { container } = render(<ActivityStateBadge state={state} />);
		expect(within(container).getByText(label)).toBeDefined();
	}
});

it("exposes the state through the dot's aria-label", () => {
	const { container } = render(<ActivityDot state="working" />);
	expect(within(container).getByLabelText("Working")).toBeDefined();
});

it("renders a neutral placeholder for a null state without throwing", () => {
	const { container } = render(<ActivityDot state={null} />);
	expect(within(container).getByLabelText("Status unknown")).toBeDefined();
});

it("renders a neutral placeholder for an unknown state string", () => {
	const { container } = render(<ActivityStateBadge state="bogus" />);
	expect(within(container).getByText(UNKNOWN)).toBeDefined();
});
