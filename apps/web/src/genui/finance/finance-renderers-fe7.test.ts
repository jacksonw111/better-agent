import { expect, it } from "vitest";
import { TOOL_RESULT_RENDERERS } from "../tool-renderers";

// FE-7 slice: finance_macro_us / finance_macro_cn (macro-panel.tsx) and
// finance_earnings_calendar / finance_economic_calendar / finance_central_bank
// (calendar-list.tsx). Split out of finance-renderers.test.ts (which is at
// the project's 300-line-per-file cap) — same pattern as
// finance-renderers-fe6.test.ts.

const MACRO_US_DASHBOARD_FIXTURE = {
	dashboard: [
		{
			date: "2026-06-01",
			indicator: "cpi",
			seriesId: "CPIAUCSL",
			value: 320.5,
		},
		{
			date: "2026-06-01",
			indicator: "unemployment",
			seriesId: "UNRATE",
			value: 4.1,
		},
	],
};

const MACRO_US_SERIES_FIXTURE = {
	indicator: "cpi",
	observations: [
		{ date: "2026-05-01", value: 319.8 },
		{ date: "2026-06-01", value: 320.5 },
	],
	seriesId: "CPIAUCSL",
};

const MACRO_CN_DASHBOARD_FIXTURE = {
	dashboard: [
		{
			indicator: "cpi",
			latest: { cumulative: 1.1, mom: 0.2, time: "2026-06-01", yoy: 2.3 },
		},
		{ indicator: "pmi", latest: { manufacturing: 50.2, time: "2026-06-01" } },
	],
};

const MACRO_CN_ROWS_FIXTURE = {
	indicator: "cpi",
	rows: [
		{ cumulative: 1.1, mom: 0.2, time: "2026-06-01", yoy: 2.3 },
		{ cumulative: 0.9, mom: 0.1, time: "2026-05-01", yoy: 2.1 },
	],
};

const EARNINGS_FIXTURE = {
	date: "2026-07-15",
	isPublished: false,
	market: "us",
	name: "Apple Inc.",
	reportType: "q3",
	session: "amc",
	symbol: "AAPL",
};

const ECONOMIC_FIXTURE = {
	actual: "3.1%",
	country: "US",
	date: "2026-07-10",
	estimate: "3.0%",
	event: "CPI YoY",
	impact: "high",
	prior: "2.9%",
	time: "08:30",
};

const CENTRAL_BANK_FIXTURE = {
	amount: 150_000_000_000,
	date: "2026-07-09",
	rate: 1.8,
	tenor: "7D",
	type: "reverse repo",
};

function financeTool(name: string) {
	const tool = TOOL_RESULT_RENDERERS[name];
	if (!tool) {
		throw new Error(`${name} must be registered`);
	}
	return tool;
}

it("parses a finance_macro_us dashboard fixture", () => {
	expect(
		financeTool("finance_macro_us").parse(MACRO_US_DASHBOARD_FIXTURE)
	).not.toBeNull();
});

it("parses a finance_macro_us series fixture", () => {
	expect(
		financeTool("finance_macro_us").parse(MACRO_US_SERIES_FIXTURE)
	).not.toBeNull();
});

it("returns null for finance_macro_us given a wrong shape", () => {
	expect(
		financeTool("finance_macro_us").parse({ unrelated: "shape" })
	).toBeNull();
});

it("parses a finance_macro_cn dashboard fixture", () => {
	expect(
		financeTool("finance_macro_cn").parse(MACRO_CN_DASHBOARD_FIXTURE)
	).not.toBeNull();
});

it("parses a finance_macro_cn rows fixture", () => {
	expect(
		financeTool("finance_macro_cn").parse(MACRO_CN_ROWS_FIXTURE)
	).not.toBeNull();
});

it("returns null for finance_macro_cn given a wrong shape", () => {
	expect(
		financeTool("finance_macro_cn").parse({ unrelated: "shape" })
	).toBeNull();
});

it("parses a representative finance_earnings_calendar fixture", () => {
	expect(
		financeTool("finance_earnings_calendar").parse([EARNINGS_FIXTURE])
	).not.toBeNull();
});

it("returns null for finance_earnings_calendar given a wrong shape", () => {
	expect(
		financeTool("finance_earnings_calendar").parse([{ unrelated: "shape" }])
	).toBeNull();
});

it("parses a representative finance_economic_calendar fixture", () => {
	expect(
		financeTool("finance_economic_calendar").parse([ECONOMIC_FIXTURE])
	).not.toBeNull();
});

it("returns null for finance_economic_calendar given a wrong shape", () => {
	expect(
		financeTool("finance_economic_calendar").parse([{ unrelated: "shape" }])
	).toBeNull();
});

it("parses a representative finance_central_bank fixture", () => {
	expect(
		financeTool("finance_central_bank").parse([CENTRAL_BANK_FIXTURE])
	).not.toBeNull();
});

it("returns null for finance_central_bank given a wrong shape", () => {
	expect(
		financeTool("finance_central_bank").parse([{ unrelated: "shape" }])
	).toBeNull();
});
