// @vitest-environment jsdom
import { fireEvent, render, within } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { DragonTigerTable } from "./dragon-tiger-table";

// Smoke test for finance_dragon_tiger's `RankList` wiring (design doc §8.6;
// reclassified from the doc's original LadderTable slot — see
// dragon-tiger-table.tsx's module comment for why). Archetype-level
// Sort/Filter/Expand mechanics are covered by rank-list.test.tsx; this only
// asserts dragon-tiger-table.tsx's own field mapping — ranking by
// billboardAmount, the close+ChangePct secondary, and the full 上榜原因 text
// only surfacing once a row is expanded.
vi.mock("./motion", async (importOriginal) => {
	const actual = await importOriginal<typeof import("./motion")>();
	return { ...actual, useReducedMotion: () => true };
});

const ROWS = [
	{
		billboardAmount: 500_000_000,
		changePct: 9.98,
		close: 12.34,
		code: "600000",
		name: "浦发银行",
		reason: "日涨幅偏离值达7%的证券",
		tradeDate: "2026-07-10",
		turnoverRate: 15.2,
	},
	{
		billboardAmount: 1_200_000_000,
		changePct: -3.5,
		close: 45.6,
		code: "000001",
		name: "平安银行",
		reason: "连续三个交易日内,涨幅偏离值累计达20%的证券",
		tradeDate: "2026-07-10",
		turnoverRate: 22.1,
	},
];

function isBefore(first: Element, second: Element): boolean {
	const mask = first.compareDocumentPosition(second);
	// biome-ignore lint/suspicious/noBitwiseOperators: compareDocumentPosition bitmask check, standard DOM idiom.
	return Boolean(mask & Node.DOCUMENT_POSITION_FOLLOWING);
}

const REASON_RE = /日涨幅偏离值达7%的证券/;
const TURNOVER_RE = /换手率 15.20%/;

it("ranks rows by 龙虎榜成交额 (billboardAmount) descending", () => {
	const { container } = render(<DragonTigerTable data={ROWS} />);
	const scope = within(container);
	// 平安银行's billboardAmount (1.2B) > 浦发银行's (500M).
	expect(
		isBefore(scope.getByText("平安银行"), scope.getByText("浦发银行"))
	).toBe(true);
});

it("shows 收盘价 and ChangePct as the secondary figures", () => {
	const { container } = render(<DragonTigerTable data={ROWS} />);
	const scope = within(container);
	expect(scope.getByText("12.34")).toBeDefined();
	expect(scope.getByText("+9.98%")).toBeDefined();
	expect(scope.getByText("45.60")).toBeDefined();
	expect(scope.getByText("-3.50%")).toBeDefined();
});

it("reveals 换手率 and the full 上榜原因 text only once a row is expanded", () => {
	const { container } = render(<DragonTigerTable data={ROWS} />);
	const scope = within(container);
	expect(scope.queryByText(REASON_RE)).toBeNull();
	fireEvent.click(scope.getByText("浦发银行").closest("button") as HTMLElement);
	expect(scope.getByText(TURNOVER_RE)).toBeDefined();
	expect(scope.getByText(REASON_RE)).toBeDefined();
});

it("renders nothing for an empty result", () => {
	const { container } = render(<DragonTigerTable data={[]} />);
	expect(container.textContent).toBe("");
});
