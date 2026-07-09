import { expect, it } from "vitest";
import { TOOL_RESULT_RENDERERS } from "../tool-renderers";

// FE-5 slice: finance_top_holders / finance_dividends / finance_dragon_tiger
// / finance_hsgt_flow. Split out of finance-renderers.test.ts (which is at
// the project's 300-line-per-file cap) — same pattern as
// types.ts/types-extra.ts splitting in apps/finance-mcp.

const TOP_HOLDER_FIXTURE = {
	changeRatio: 1.2,
	changeShares: 1_200_000,
	endDate: "2025-12-31",
	freeFloatRatio: 8.5,
	holder: "香港中央结算有限公司",
	isInstitution: true,
	rank: 1,
	shares: 120_000_000,
};

const DIVIDEND_FIXTURE = {
	bonusRatioDividend: 280.24,
	bonusRatioTransfer: 0,
	exDividendDate: "2026-06-20",
	noticeDate: "2026-05-15",
	plan: "10派280.24元(含税)",
	pretaxDividendRmb: 35_200_000_000,
	progress: "实施",
	recordDate: "2026-06-19",
	reportDate: "2025-12-31",
};

const DRAGON_TIGER_FIXTURE = {
	billboardAmount: 850_000_000,
	changePct: 9.98,
	close: 15.6,
	code: "000001",
	name: "平安银行",
	reason: "日涨幅偏离值达7%的证券",
	tradeDate: "2026-07-07",
	turnoverRate: 12.4,
};

const HSGT_NORTH_FIXTURE = {
	buyAmt: 1234.5,
	channel: "沪股通",
	direction: "north",
	indexChangeRate: 0.5,
	leadStock: "贵州茅台",
	netAmt: null,
	sellAmt: 1000.2,
	tradeDate: "2026-07-08",
};

const HSGT_SOUTH_FIXTURE = {
	buyAmt: 2000,
	channel: "港股通(沪)",
	direction: "south",
	indexChangeRate: -0.2,
	leadStock: "腾讯控股",
	netAmt: 5678.9,
	sellAmt: 500,
	tradeDate: "2026-07-08",
};

function financeTool(name: string) {
	const tool = TOOL_RESULT_RENDERERS[name];
	if (!tool) {
		throw new Error(`${name} must be registered`);
	}
	return tool;
}

it("parses a representative finance_top_holders fixture", () => {
	expect(
		financeTool("finance_top_holders").parse([TOP_HOLDER_FIXTURE])
	).not.toBeNull();
});

it("returns null for finance_top_holders given a wrong shape", () => {
	expect(
		financeTool("finance_top_holders").parse([{ unrelated: "shape" }])
	).toBeNull();
});

it("parses a representative finance_dividends fixture", () => {
	expect(
		financeTool("finance_dividends").parse([DIVIDEND_FIXTURE])
	).not.toBeNull();
});

it("returns null for finance_dividends given a wrong shape", () => {
	expect(
		financeTool("finance_dividends").parse([{ unrelated: "shape" }])
	).toBeNull();
});

it("parses a representative finance_dragon_tiger fixture", () => {
	expect(
		financeTool("finance_dragon_tiger").parse([DRAGON_TIGER_FIXTURE])
	).not.toBeNull();
});

it("returns null for finance_dragon_tiger given a wrong shape", () => {
	expect(
		financeTool("finance_dragon_tiger").parse([{ unrelated: "shape" }])
	).toBeNull();
});

it("parses a representative finance_hsgt_flow fixture including a null-netAmt northbound row", () => {
	expect(
		financeTool("finance_hsgt_flow").parse([
			HSGT_NORTH_FIXTURE,
			HSGT_SOUTH_FIXTURE,
		])
	).not.toBeNull();
});

it("returns null for finance_hsgt_flow given a wrong shape", () => {
	expect(
		financeTool("finance_hsgt_flow").parse([{ unrelated: "shape" }])
	).toBeNull();
});
