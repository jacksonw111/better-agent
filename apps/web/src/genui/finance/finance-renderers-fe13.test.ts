import { expect, it } from "vitest";
import { TOOL_RESULT_RENDERERS } from "../tool-renderers";

// FE-13 slice: finance_earnings_preannounce (preannounce-list.tsx),
// finance_lockup (lockup-table.tsx), finance_convertible_bonds
// (convertible-bonds-table.tsx), and finance_ipo (ipo-table.tsx). Split out
// of finance-renderers.test.ts (which is at the project's 300-line-per-file
// cap) — same pattern as finance-renderers-fe12.test.ts.

const PREANNOUNCE_FIXTURE = {
	changeLower: 10,
	changeUpper: 20,
	code: "600519",
	content: "预计净利润同比增长10%-20%",
	name: "贵州茅台",
	noticeDate: "2026-07-08",
	reason: "主营业务收入增长",
	reportDate: "2026-06-30",
	type: "预增",
};

const LOCKUP_FIXTURE = {
	code: "600519",
	freeDate: "2026-08-15",
	freeRatio: 5.2,
	freeShares: 12_000_000,
	liftMarketCap: 2_100_000_000,
	name: "贵州茅台",
	type: "首发原股东限售股份",
};

const CONVERTIBLE_BOND_FIXTURE = {
	code: "113050",
	expireDate: "2032-01-15",
	issuePrice: 100,
	issueScale: 1_500_000_000,
	listingDate: "2026-02-01",
	name: "浦发转债",
	rating: "AAA",
	stockCode: "600000",
};

const IPO_FIXTURE = {
	afterPe: 22.5,
	applyCode: "780519",
	applyDate: "2026-07-10",
	applyUpper: 15_000,
	code: "300519",
	industryPe: 28.1,
	issuePrice: 35.6,
	listingDate: "2026-07-20",
	market: "深圳创业板",
	name: "示例科技",
};

function financeTool(name: string) {
	const tool = TOOL_RESULT_RENDERERS[name];
	if (!tool) {
		throw new Error(`${name} must be registered`);
	}
	return tool;
}

it("parses a representative finance_earnings_preannounce fixture", () => {
	expect(
		financeTool("finance_earnings_preannounce").parse([PREANNOUNCE_FIXTURE])
	).not.toBeNull();
});

it("returns null for finance_earnings_preannounce given a wrong shape", () => {
	expect(
		financeTool("finance_earnings_preannounce").parse([{ unrelated: "shape" }])
	).toBeNull();
});

it("parses a representative finance_lockup fixture", () => {
	expect(financeTool("finance_lockup").parse([LOCKUP_FIXTURE])).not.toBeNull();
});

it("returns null for finance_lockup given a wrong shape", () => {
	expect(
		financeTool("finance_lockup").parse([{ unrelated: "shape" }])
	).toBeNull();
});

it("parses a representative finance_convertible_bonds fixture", () => {
	expect(
		financeTool("finance_convertible_bonds").parse([CONVERTIBLE_BOND_FIXTURE])
	).not.toBeNull();
});

it("returns null for finance_convertible_bonds given a wrong shape", () => {
	expect(
		financeTool("finance_convertible_bonds").parse([{ unrelated: "shape" }])
	).toBeNull();
});

it("parses a representative finance_ipo fixture", () => {
	expect(financeTool("finance_ipo").parse([IPO_FIXTURE])).not.toBeNull();
});

it("returns null for finance_ipo given a wrong shape", () => {
	expect(financeTool("finance_ipo").parse([{ unrelated: "shape" }])).toBeNull();
});
