// @vitest-environment jsdom
import { fireEvent, render, within } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { OptionChain } from "./option-chain";

// Render-level tests for the LadderTable archetype's own logic: the
// strike-pairing (call+put at the same strike collapse into one T-board row)
// plus the F (filter wing) / So (sort) / E (expand) interaction verbs this
// task adds. Archetype-generic Sort/Filter/Expand mechanics belong to their
// respective hooks (use-sort.test.ts/use-filter.test.ts/use-expand.test.ts);
// this only covers option-chain's own wiring of them. Follows
// tweet-card-node.test.tsx's convention: `within(container)`-scoped queries
// and `.toBeDefined()` (no jest-dom matchers configured in this project's
// vitest setup).
vi.mock("./motion", async (importOriginal) => {
	const actual = await importOriginal<typeof import("./motion")>();
	return { ...actual, useReducedMotion: () => true };
});

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

const CALL_AT_3_75 = {
	changePct: 1.1,
	code: "10008768",
	kind: "call" as const,
	last: 0.2,
	name: "300ETF购7月3750",
	strike: 3.75,
	volume: 500,
};

const CALL_NAME_RE = /300ETF购7月4000/;
const PUT_NAME_RE = /300ETF沽7月4000/;

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

it("hides the put wing's columns when filtered to 仅认购", () => {
	const { container } = render(<OptionChain data={[CALL_AT_4, PUT_AT_4]} />);
	const scope = within(container);
	fireEvent.click(scope.getByRole("button", { name: "仅认购" }));
	expect(scope.getByText("认购量")).toBeDefined();
	expect(scope.queryByText("认沽量")).toBeNull();
	expect(scope.queryByText("认沽价")).toBeNull();
	expect(scope.queryByText("认沽涨跌幅")).toBeNull();
});

it("hides the call wing's columns when filtered to 仅认沽", () => {
	const { container } = render(<OptionChain data={[CALL_AT_4, PUT_AT_4]} />);
	const scope = within(container);
	fireEvent.click(scope.getByRole("button", { name: "仅认沽" }));
	expect(scope.getByText("认沽量")).toBeDefined();
	expect(scope.queryByText("认购量")).toBeNull();
	expect(scope.queryByText("认购价")).toBeNull();
	expect(scope.queryByText("认购涨跌幅")).toBeNull();
});

it("reorders strikes by combined leg volume when 成交量 sort is selected", () => {
	const { container } = render(
		<OptionChain data={[CALL_AT_3_75, CALL_AT_4, PUT_AT_4, CALL_AT_4_25]} />
	);
	const scope = within(container);
	const firstDataRowText = () =>
		(scope.getAllByRole("row")[1] as HTMLElement).textContent;
	// Default 行权价升序: strike 3.75 (the lowest) leads.
	expect(firstDataRowText()).toContain("3.75");
	fireEvent.click(scope.getByRole("button", { name: "成交量" }));
	// 4.00's combined volume (15,800 + 9,400 = 25,200) beats every other
	// strike, including 3.75 (500 alone).
	expect(firstDataRowText()).toContain("4.00");
});

it("expand reveals both legs' code and name", () => {
	const { container } = render(<OptionChain data={[CALL_AT_4, PUT_AT_4]} />);
	const scope = within(container);
	expect(scope.queryByText(CALL_NAME_RE)).toBeNull();
	fireEvent.click(scope.getAllByRole("row")[1] as HTMLElement);
	expect(scope.getByText(CALL_NAME_RE)).toBeDefined();
	expect(scope.getByText(PUT_NAME_RE)).toBeDefined();
});

it("renders nothing for an empty result", () => {
	const { container } = render(<OptionChain data={[]} />);
	expect(container.textContent).toBe("");
});
