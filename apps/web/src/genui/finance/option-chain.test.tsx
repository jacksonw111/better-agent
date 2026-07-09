// @vitest-environment jsdom
import { render, within } from "@testing-library/react";
import { expect, it } from "vitest";
import { OptionChain } from "./option-chain";

// Render-level test for the T-board pairing logic in option-chain.tsx: a
// call and a put at the SAME strike must collapse into a single table row
// (one 行权价 cell), not two separate rows — the parse-level assertions in
// finance-renderers-fe14.test.ts only cover schema validation, not this
// grouping behavior. Follows tweet-card-node.test.tsx's convention:
// `within(container)`-scoped queries and `.toBeDefined()` (no jest-dom
// matchers configured in this project's vitest setup).

const CALL_AT_4 = {
	changePct: 12.5,
	code: "10008765",
	kind: "call" as const,
	last: 0.0856,
	name: "300ETF购7月4000",
	strike: 4,
	volume: 15_800,
};

const PUT_AT_4 = {
	changePct: -8.2,
	code: "10008766",
	kind: "put" as const,
	last: 0.1023,
	name: "300ETF沽7月4000",
	strike: 4,
	volume: 9400,
};

const CALL_AT_4_25 = {
	changePct: 5,
	code: "10008767",
	kind: "call" as const,
	last: 0.06,
	name: "300ETF购7月4250",
	strike: 4.25,
	volume: 3200,
};

it("pairs a call and a put at the same strike into one T-board row", () => {
	const { container } = render(<OptionChain data={[CALL_AT_4, PUT_AT_4]} />);
	const scope = within(container);
	const rows = scope.getAllByRole("row");
	// One header row + one data row (call and put share a strike, not two).
	expect(rows.length).toBe(2);
	const dataRow = within(rows[1] as HTMLElement);
	expect(dataRow.getByText("4.00")).toBeDefined();
	// call last (0.0856 -> "0.09") and put last (0.1023 -> "0.10") both
	// present on the same row.
	expect(dataRow.getByText("0.09")).toBeDefined();
	expect(dataRow.getByText("0.10")).toBeDefined();
});

it("renders a strike with only one leg using — for the missing side", () => {
	const { container } = render(<OptionChain data={[CALL_AT_4_25]} />);
	const scope = within(container);
	const rows = scope.getAllByRole("row");
	expect(rows.length).toBe(2);
	const cells = within(rows[1] as HTMLElement).getAllByRole("cell");
	// call side (first 3 cells) populated, put side (last 3 cells) is "—".
	expect(cells.at(-1)?.textContent).toBe("—");
	expect(cells.at(-2)?.textContent).toBe("—");
	expect(cells.at(-3)?.textContent).toBe("—");
});

it("renders nothing for an empty result", () => {
	const { container } = render(<OptionChain data={[]} />);
	expect(container.textContent).toBe("");
});
