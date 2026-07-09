import { expect, it } from "vitest";
import { TOOL_RESULT_RENDERERS } from "../tool-renderers";

// FE-11 slice: finance_margin / finance_divergence. Split out of
// finance-renderers.test.ts (which is at the project's 300-line-per-file
// cap) — same pattern as finance-renderers-fe9.test.ts.

const MARGIN_ROW_FIXTURE = {
	date: "2026-07-08",
	financingBalance: 1_499_222_864_079,
	financingBalanceRatio: 8.42,
	financingBuy: 21_345_678_901,
	securitiesBalance: 34_567_890_123,
	securitiesVolume: 1_234_567,
	totalBalance: 1_533_790_754_202,
};

const DIVERGENCE_FIXTURE = {
	bearishPct: 61,
	buzzScore: 78,
	bullishPct: 22,
	note: "价格创近5日新高，但舆情热度与看多比例同步走弱，警惕顶背离风险。",
	priceChange1d: 1.8,
	priceChange5d: 6.4,
	priceTrend: "rising",
	sentimentNet: -12.5,
	sentimentScore: -0.18,
	sentimentTrend: "falling",
	signal: "顶背离",
	ticker: "TSLA",
};

function financeTool(name: string) {
	const tool = TOOL_RESULT_RENDERERS[name];
	if (!tool) {
		throw new Error(`${name} must be registered`);
	}
	return tool;
}

it("parses a representative finance_margin fixture", () => {
	expect(
		financeTool("finance_margin").parse([MARGIN_ROW_FIXTURE])
	).not.toBeNull();
});

it("returns null for finance_margin given a wrong shape", () => {
	expect(
		financeTool("finance_margin").parse([{ unrelated: "shape" }])
	).toBeNull();
});

it("parses a representative finance_divergence fixture (顶背离)", () => {
	expect(
		financeTool("finance_divergence").parse(DIVERGENCE_FIXTURE)
	).not.toBeNull();
});

it("returns null for finance_divergence given a wrong shape", () => {
	expect(
		financeTool("finance_divergence").parse({ unrelated: "shape" })
	).toBeNull();
});
