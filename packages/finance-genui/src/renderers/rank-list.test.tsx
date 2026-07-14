// @vitest-environment jsdom
import { fireEvent, render, within } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { RankList } from "./rank-list";
import type { RankListFilter, RankListSortOption } from "./rank-list-types";

// Render-level tests for the `RankList` archetype (design doc §8.6, contract
// So·F·E·I) over a SYNTHETIC fixture. `useReducedMotion` is mocked to true
// (matching proportion-bar.test.tsx) so the bar fill renders at its final
// width synchronously instead of animating over a real frame, which
// render() doesn't wait for. Follows data-table.test.tsx's `within(container)`
// convention (no jest-dom matchers configured).
vi.mock("./motion", async (importOriginal) => {
	const actual = await importOriginal<typeof import("./motion")>();
	return { ...actual, useReducedMotion: () => true };
});

const METRIC_LABEL_RE = /热度/;

interface Row {
	category: "a" | "b";
	id: string;
	metric: number;
	name: string;
	price: number;
}

const ROWS: Row[] = [
	{ category: "a", id: "1", metric: 100, name: "Alpha", price: 10 },
	{ category: "a", id: "2", metric: 50, name: "Beta", price: 20 },
	{ category: "b", id: "3", metric: 25, name: "Gamma", price: 30 },
];

const FILTERS: RankListFilter<Row>[] = [
	{ id: "a", label: "A组", predicate: (row) => row.category === "a" },
	{ id: "b", label: "B组", predicate: (row) => row.category === "b" },
];

const SORT_OPTIONS: RankListSortOption<Row>[] = [
	{ accessor: (row) => row.price, id: "price", label: "价格" },
];

function renderRankList(
	overrides: Partial<Parameters<typeof RankList<Row>>[0]> = {}
) {
	return render(
		<RankList<Row>
			filters={FILTERS}
			getRowKey={(row) => row.id}
			items={ROWS}
			metricLabel="热度"
			rankMetric={(row) => row.metric}
			renderExpanded={(row) => <div>{`详情 ${row.name}`}</div>}
			renderPrimary={(row) => <span>{row.name}</span>}
			renderSecondary={(row) => <span>{row.price}</span>}
			sortOptions={SORT_OPTIONS}
			title="排行榜"
			{...overrides}
		/>
	);
}

/** One ProportionBar fill per row, in document (= render) order. */
function barWidths(container: HTMLElement): string[] {
	return Array.from(container.querySelectorAll("div.absolute")).map(
		(el) => (el as HTMLElement).style.width
	);
}

/** Document-order comparison, mirrors news-feed.test.tsx's `isBefore`. */
function isBefore(first: Element, second: Element): boolean {
	const mask = first.compareDocumentPosition(second);
	// biome-ignore lint/suspicious/noBitwiseOperators: compareDocumentPosition returns a bitmask; testing it against DOCUMENT_POSITION_FOLLOWING is the standard DOM idiom, not an accidental `&&` typo.
	return Boolean(mask & Node.DOCUMENT_POSITION_FOLLOWING);
}

it("renders rows in descending-metric order with bar widths proportional to the set's max", () => {
	const { container } = renderRankList();
	const scope = within(container);
	expect(isBefore(scope.getByText("Alpha"), scope.getByText("Beta"))).toBe(
		true
	);
	expect(isBefore(scope.getByText("Beta"), scope.getByText("Gamma"))).toBe(
		true
	);
	expect(barWidths(container)).toEqual(["100%", "50%", "25%"]);
});

it("reorders rows when a different Sort option is selected", () => {
	const { container } = renderRankList();
	const scope = within(container);
	// default: Alpha(100) > Beta(50) > Gamma(25). By 价格: Gamma(30) > Beta(20) > Alpha(10).
	fireEvent.click(scope.getByRole("button", { name: "价格" }));
	expect(isBefore(scope.getByText("Gamma"), scope.getByText("Beta"))).toBe(
		true
	);
	expect(isBefore(scope.getByText("Beta"), scope.getByText("Alpha"))).toBe(
		true
	);
});

it("narrows rows via a Filter option and rescales bars to the narrowed set's max", async () => {
	const { container } = renderRankList();
	const scope = within(container);
	fireEvent.click(scope.getByRole("button", { name: "B组" }));
	expect(scope.queryByText("Alpha")).toBeNull();
	expect(scope.queryByText("Beta")).toBeNull();
	expect(scope.getByText("Gamma")).toBeDefined();
	// Gamma alone is now the set's max (25), so its bar fills the full track.
	// The bar's `animate` re-target on an already-mounted motion.div resolves
	// on the next animation frame (unlike the initial-mount draw, which
	// `initial={false}` applies synchronously) — poll instead of asserting
	// immediately after the click.
	await vi.waitFor(() => {
		expect(barWidths(container)).toEqual(["100%"]);
	});
});

it("expands a row to reveal its detail content", () => {
	const { container } = renderRankList();
	const scope = within(container);
	expect(scope.queryByText("详情 Alpha")).toBeNull();
	fireEvent.click(scope.getByText("Alpha").closest("button") as HTMLElement);
	expect(scope.getByText("详情 Alpha")).toBeDefined();
});

it("omits Filter controls and the Expand affordance when the caller supplies neither", () => {
	const { container } = renderRankList({
		filters: undefined,
		renderExpanded: undefined,
	});
	const scope = within(container);
	expect(scope.queryByRole("button", { name: "A组" })).toBeNull();
	expect(scope.getByText("Alpha").closest("button")).toBeNull();
	// Sort still renders — every RankList has a headline metric to sort by.
	expect(scope.getByRole("button", { name: METRIC_LABEL_RE })).toBeDefined();
});
