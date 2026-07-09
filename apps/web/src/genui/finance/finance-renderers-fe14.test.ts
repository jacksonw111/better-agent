import { expect, it } from "vitest";
import { TOOL_RESULT_RENDERERS } from "../tool-renderers";

// FE-14 (V6b) slice: finance_index_weights (index-weights.tsx),
// finance_etf_list (etf-list.tsx), finance_option_chain (option-chain.tsx).
// Split out of finance-renderers.test.ts — same pattern as
// finance-renderers-fe13.test.ts (finance-renderers.test.ts is at the
// project's 300-line-per-file cap).

const INDEX_WEIGHT_FIXTURE = {
	changePct: 1.24,
	closePrice: 1789.5,
	code: "600519",
	industry: "食品饮料",
	name: "贵州茅台",
	pe: 28.3,
	roe: 31.2,
	weight: 4.5,
};

const ETF_FIXTURE = {
	changePct: -0.87,
	code: "510300",
	name: "沪深300ETF",
	price: 3.912,
	turnover: 812_000_000,
	turnoverRate: 1.35,
	volume: 208_000_000,
};

const CALL_OPTION_FIXTURE = {
	changePct: 12.5,
	code: "10008765",
	kind: "call",
	last: 0.0856,
	name: "300ETF购7月4000",
	strike: 4,
	volume: 15_800,
};

const PUT_OPTION_FIXTURE = {
	changePct: -8.2,
	code: "10008766",
	kind: "put",
	last: 0.1023,
	name: "300ETF沽7月4000",
	strike: 4,
	volume: 9400,
};

function financeTool(name: string) {
	const tool = TOOL_RESULT_RENDERERS[name];
	if (!tool) {
		throw new Error(`${name} must be registered`);
	}
	return tool;
}

it("parses a representative finance_index_weights fixture", () => {
	expect(
		financeTool("finance_index_weights").parse([INDEX_WEIGHT_FIXTURE])
	).not.toBeNull();
});

it("returns null for finance_index_weights given a wrong shape", () => {
	expect(
		financeTool("finance_index_weights").parse([{ unrelated: "shape" }])
	).toBeNull();
});

it("parses a representative finance_etf_list fixture", () => {
	expect(financeTool("finance_etf_list").parse([ETF_FIXTURE])).not.toBeNull();
});

it("returns null for finance_etf_list given a wrong shape", () => {
	expect(
		financeTool("finance_etf_list").parse([{ unrelated: "shape" }])
	).toBeNull();
});

it("parses a representative finance_option_chain fixture", () => {
	expect(
		financeTool("finance_option_chain").parse([
			CALL_OPTION_FIXTURE,
			PUT_OPTION_FIXTURE,
		])
	).not.toBeNull();
});

it("returns null for finance_option_chain given a wrong shape", () => {
	expect(
		financeTool("finance_option_chain").parse([{ unrelated: "shape" }])
	).toBeNull();
});

it("pairs a call and put at the same strike into one T-board row", () => {
	const parsed = financeTool("finance_option_chain").parse([
		CALL_OPTION_FIXTURE,
		PUT_OPTION_FIXTURE,
	]) as Array<{ kind: string; strike: number }>;
	expect(parsed).toHaveLength(2);
	const strikes = new Set(parsed.map((row) => row.strike));
	expect(strikes.size).toBe(1);
	const kinds = parsed.map((row) => row.kind).sort();
	expect(kinds).toEqual(["call", "put"]);
});
