// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { Terminal } from "./terminal";
import { makeControllableTransport, SESSION } from "./terminal-test-helpers";

const CONTEXT_USAGE_LABEL_PATTERN = /Context usage:/;

// R4-T2: the header's context mini-bar — a glanceable 32px-wide fill + pct%
// next to the Status trigger, sourced from whichever of `usage_update`
// (opencode's streamed context/cost) or the last `status_snapshot` most
// recently reported a context percentage (see `deriveContextPct` in
// bridge-usage-format.ts). Hidden entirely when neither source has anything
// usable, rather than showing a misleading 0%.

afterEach(() => {
	cleanup();
});

function makeTransportWithHistory(events: unknown[]) {
	const fake = makeControllableTransport();
	fake.history.mockResolvedValue(
		events.map((event, index) => ({ seq: index + 1, event }))
	);
	return fake;
}

it("renders the mini bar from a status_snapshot's context pct", async () => {
	const fake = makeTransportWithHistory([
		{
			kind: "status",
			status: "status_snapshot",
			detail: { contextUsage: { pct: 24 } },
		},
	]);
	render(<Terminal session={SESSION} transport={fake.transport} />);

	await waitFor(() => {
		expect(screen.getByLabelText("Context usage: 24%")).toBeDefined();
	});
});

it("renders the mini bar from a streamed usage_update's used/size", async () => {
	const fake = makeTransportWithHistory([
		{
			kind: "status",
			status: "usage_update",
			detail: { used: 100_000, size: 200_000 },
		},
	]);
	render(<Terminal session={SESSION} transport={fake.transport} />);

	await waitFor(() => {
		expect(screen.getByLabelText("Context usage: 50%")).toBeDefined();
	});
});

it("hides the mini bar when no context percentage is known", async () => {
	render(
		<Terminal
			session={SESSION}
			transport={makeTransportWithHistory([]).transport}
		/>
	);

	await waitFor(() => {
		expect(screen.getByRole("button", { name: "Status" })).toBeDefined();
	});
	expect(screen.queryByLabelText(CONTEXT_USAGE_LABEL_PATTERN)).toBeNull();
});
