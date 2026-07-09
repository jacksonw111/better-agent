import { expect, it } from "vitest";
import { TOOL_RESULT_RENDERERS } from "../tool-renderers";

// FE-15 (V7) slice: finance_block_trades (block-trades-table.tsx),
// finance_insider_trades (insider-table.tsx), finance_suspension
// (suspension-table.tsx). Split out of finance-renderers.test.ts — same
// pattern as finance-renderers-fe14.test.ts (finance-renderers.test.ts is at
// the project's 300-line-per-file cap).

const BLOCK_TRADE_FIXTURE = {
	buyer: "机构专用",
	code: "600519",
	dealAmount: 168_000_000,
	dealPrice: 1680,
	dealVolume: 100_000,
	name: "贵州茅台",
	premiumPct: -2.1,
	seller: "某券商营业部",
	tradeDate: "2026-07-08",
};

const INSIDER_INCREASE_FIXTURE = {
	avgPrice: 45.2,
	changeAmount: 22_600_000,
	changeDate: "2026-07-08",
	changeRatio: 0.12,
	changeShares: 500_000,
	code: "300750",
	holdType: "增持",
	name: "宁德时代",
	person: "曾毓群",
	position: "董事长",
	reason: "看好公司长期发展",
	relatedExec: "",
};

const INSIDER_DECREASE_FIXTURE = {
	avgPrice: 45.2,
	changeAmount: -11_300_000,
	changeDate: "2026-07-07",
	changeRatio: -0.06,
	changeShares: -250_000,
	code: "300750",
	holdType: "减持",
	name: "宁德时代",
	person: "某副总经理",
	position: "副总经理",
	reason: "个人资金需求",
	relatedExec: "",
};

const SUSPENSION_FIXTURE = {
	code: "600001",
	expire: "预计1天",
	name: "某某股份",
	predictResume: "2026-07-09",
	reason: "重大事项",
	suspendEnd: null,
	suspendStart: "2026-07-08",
};

function financeTool(name: string) {
	const tool = TOOL_RESULT_RENDERERS[name];
	if (!tool) {
		throw new Error(`${name} must be registered`);
	}
	return tool;
}

it("parses a representative finance_block_trades fixture", () => {
	expect(
		financeTool("finance_block_trades").parse([BLOCK_TRADE_FIXTURE])
	).not.toBeNull();
});

it("returns null for finance_block_trades given a wrong shape", () => {
	expect(
		financeTool("finance_block_trades").parse([{ unrelated: "shape" }])
	).toBeNull();
});

it("parses a representative finance_insider_trades fixture", () => {
	expect(
		financeTool("finance_insider_trades").parse([INSIDER_INCREASE_FIXTURE])
	).not.toBeNull();
});

it("returns null for finance_insider_trades given a wrong shape", () => {
	expect(
		financeTool("finance_insider_trades").parse([{ unrelated: "shape" }])
	).toBeNull();
});

it("keeps a negative changeShares row (减持) in finance_insider_trades parse", () => {
	const parsed = financeTool("finance_insider_trades").parse([
		INSIDER_DECREASE_FIXTURE,
	]) as Array<{ changeShares: number | null }>;
	expect(parsed).toHaveLength(1);
	expect(parsed[0]?.changeShares).toBeLessThan(0);
});

it("parses a representative finance_suspension fixture", () => {
	expect(
		financeTool("finance_suspension").parse([SUSPENSION_FIXTURE])
	).not.toBeNull();
});

it("returns null for finance_suspension given a wrong shape", () => {
	expect(
		financeTool("finance_suspension").parse([{ unrelated: "shape" }])
	).toBeNull();
});
