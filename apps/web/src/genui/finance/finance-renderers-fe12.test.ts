import { expect, it } from "vitest";
import { TOOL_RESULT_RENDERERS } from "../tool-renderers";

// FE-12 slice: finance_sentiment_compare / finance_holder_count /
// finance_cn_hot. Split out of finance-renderers.test.ts (which is at the
// project's 300-line-per-file cap) — same pattern as
// finance-renderers-fe9/10/11.test.ts.

const SENTIMENT_COMPARE_FIXTURE = {
	bearishPct: 18,
	bullishPct: 62,
	buzzScore: 84,
	mentions: 2310,
	name: "特斯拉",
	sentimentScore: 0.31,
	ticker: "TSLA",
	trend: "rising",
};

const HOLDER_COUNT_FIXTURE = {
	avgFreeShares: 12_345,
	avgFreeSharesRatio: 0.0021,
	changeRatio: -3.2,
	endDate: "2026-06-30",
	totalHolders: 98_765,
};

const CN_HOT_FIXTURE = {
	changePct: 4.21,
	code: "600519",
	last: 1688.5,
	name: "贵州茅台",
	rank: 1,
	rankChange: 2,
};

function financeTool(name: string) {
	const tool = TOOL_RESULT_RENDERERS[name];
	if (!tool) {
		throw new Error(`${name} must be registered`);
	}
	return tool;
}

it("parses a representative finance_sentiment_compare fixture", () => {
	expect(
		financeTool("finance_sentiment_compare").parse([SENTIMENT_COMPARE_FIXTURE])
	).not.toBeNull();
});

it("returns null for finance_sentiment_compare given a wrong shape", () => {
	expect(
		financeTool("finance_sentiment_compare").parse([{ unrelated: "shape" }])
	).toBeNull();
});

it("parses a representative finance_holder_count fixture", () => {
	expect(
		financeTool("finance_holder_count").parse([HOLDER_COUNT_FIXTURE])
	).not.toBeNull();
});

it("returns null for finance_holder_count given a wrong shape", () => {
	expect(
		financeTool("finance_holder_count").parse([{ unrelated: "shape" }])
	).toBeNull();
});

it("parses a representative finance_cn_hot fixture (股吧人气榜)", () => {
	expect(financeTool("finance_cn_hot").parse([CN_HOT_FIXTURE])).not.toBeNull();
});

it("returns null for finance_cn_hot given a wrong shape", () => {
	expect(
		financeTool("finance_cn_hot").parse([{ unrelated: "shape" }])
	).toBeNull();
});
