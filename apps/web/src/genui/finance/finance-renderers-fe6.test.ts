import { expect, it } from "vitest";
import { TOOL_RESULT_RENDERERS } from "../tool-renderers";

// FE-6 slice: finance_money_flow / finance_sector_list /
// finance_sector_constituents / finance_yield_curve. Split out of
// finance-renderers.test.ts (which is at the project's 300-line-per-file
// cap) — same pattern as finance-renderers-fe5.test.ts.

const MONEY_FLOW_FIXTURE = {
	date: "2026-07-08",
	largeNet: 120_000_000,
	mainNet: 350_000_000,
	mediumNet: -80_000_000,
	smallNet: -190_000_000,
	superNet: 230_000_000,
};

const SECTOR_FIXTURE = {
	changePct: 3.24,
	code: "BK0475",
	leadStockChangePct: 10.02,
	leadStockCode: "300750",
	mainNet: 1_850_000_000,
	name: "锂电池",
	price: 1520.4,
};

const SECTOR_CONSTITUENT_FIXTURE = {
	changePct: 1.8,
	code: "300750",
	name: "宁德时代",
	price: 185.6,
};

const YIELD_POINT_FIXTURE = {
	date: "2026-07-07",
	seriesId: "DGS10",
	tenor: "10Y",
	yield: 4.32,
};

function financeTool(name: string) {
	const tool = TOOL_RESULT_RENDERERS[name];
	if (!tool) {
		throw new Error(`${name} must be registered`);
	}
	return tool;
}

it("parses a representative finance_money_flow fixture", () => {
	expect(
		financeTool("finance_money_flow").parse([MONEY_FLOW_FIXTURE])
	).not.toBeNull();
});

it("returns null for finance_money_flow given a wrong shape", () => {
	expect(
		financeTool("finance_money_flow").parse([{ unrelated: "shape" }])
	).toBeNull();
});

it("parses a representative finance_sector_list fixture", () => {
	expect(
		financeTool("finance_sector_list").parse([SECTOR_FIXTURE])
	).not.toBeNull();
});

it("returns null for finance_sector_list given a wrong shape", () => {
	expect(
		financeTool("finance_sector_list").parse([{ unrelated: "shape" }])
	).toBeNull();
});

it("parses a representative finance_sector_constituents fixture", () => {
	expect(
		financeTool("finance_sector_constituents").parse([
			SECTOR_CONSTITUENT_FIXTURE,
		])
	).not.toBeNull();
});

it("returns null for finance_sector_constituents given a wrong shape", () => {
	expect(
		financeTool("finance_sector_constituents").parse([{ unrelated: "shape" }])
	).toBeNull();
});

it("parses a representative finance_yield_curve fixture", () => {
	expect(
		financeTool("finance_yield_curve").parse([YIELD_POINT_FIXTURE])
	).not.toBeNull();
});

it("returns null for finance_yield_curve given a wrong shape", () => {
	expect(
		financeTool("finance_yield_curve").parse([{ unrelated: "shape" }])
	).toBeNull();
});
