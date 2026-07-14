import { expect, it } from "vitest";
import { FINANCE_RENDERERS } from "./finance-renderers";

// FE-8 slice (final): finance_news / finance_stock_news (news-list.tsx),
// finance_research (research-list.tsx), finance_earnings_forecast
// (forecast-table.tsx), finance_list_reports (reports-list.tsx), and
// finance_search (search-list.tsx). Split out of finance-renderers.test.ts
// (which is at the project's 300-line-per-file cap) — same pattern as
// finance-renderers-fe7.test.ts.

const NEWS_FIXTURE = {
	id: "n-1",
	related: ["600519.SH"],
	summary: "白酒板块集体走强，龙头股涨超5%。",
	time: "2026-07-08 09:35",
	title: "白酒板块拉升",
};

const STOCK_NEWS_FIXTURE = {
	date: "2026-07-07",
	snippet: "公司发布公告称将回购不超过10亿元股份。",
	source: "东方财富网",
	title: "浦发银行拟回购股份",
	url: "https://finance.eastmoney.com/a/example.html",
};

const RESEARCH_FIXTURE = {
	date: "2026-06-20",
	epsY0: 68.5,
	epsY1: 74.2,
	epsY2: 80.1,
	org: "中信证券",
	pdfUrl: "/pdf/example-research.pdf",
	peY0: 22.1,
	peY1: 20.4,
	peY2: 18.9,
	title: "贵州茅台深度报告：稳健增长可期",
};

const FORECAST_FIXTURE = {
	eps: 68.5,
	pe: 22.1,
	revenue: 180_000_000_000,
	year: "2026",
};

const REPORT_FIXTURE = {
	artCode: "AN2026070800001",
	fiscalPeriod: "2026Q1",
	noticeDate: "2026-04-25",
	pdfUrl: "/pdf/example-report.pdf",
	reportType: "q1",
	title: "贵州茅台2026年第一季度报告",
};

const STOCK_HIT_FIXTURE = {
	code: "600519",
	exchange: "SH",
	market: "a_share",
	name: "贵州茅台",
};

function financeTool(name: string) {
	const tool = FINANCE_RENDERERS[name];
	if (!tool) {
		throw new Error(`${name} must be registered`);
	}
	return tool;
}

it("parses a representative finance_news fixture", () => {
	expect(financeTool("finance_news").parse([NEWS_FIXTURE])).not.toBeNull();
});

it("returns null for finance_news given a wrong shape", () => {
	expect(
		financeTool("finance_news").parse([{ unrelated: "shape" }])
	).toBeNull();
});

it("parses a representative finance_stock_news fixture", () => {
	expect(
		financeTool("finance_stock_news").parse([STOCK_NEWS_FIXTURE])
	).not.toBeNull();
});

it("returns null for finance_stock_news given a wrong shape", () => {
	expect(
		financeTool("finance_stock_news").parse([{ unrelated: "shape" }])
	).toBeNull();
});

it("parses a representative finance_research fixture", () => {
	expect(
		financeTool("finance_research").parse([RESEARCH_FIXTURE])
	).not.toBeNull();
});

it("returns null for finance_research given a wrong shape", () => {
	expect(
		financeTool("finance_research").parse([{ unrelated: "shape" }])
	).toBeNull();
});

it("parses a representative finance_earnings_forecast fixture", () => {
	expect(
		financeTool("finance_earnings_forecast").parse([FORECAST_FIXTURE])
	).not.toBeNull();
});

it("returns null for finance_earnings_forecast given a wrong shape", () => {
	expect(
		financeTool("finance_earnings_forecast").parse([{ unrelated: "shape" }])
	).toBeNull();
});

it("parses a representative finance_list_reports fixture", () => {
	expect(
		financeTool("finance_list_reports").parse([REPORT_FIXTURE])
	).not.toBeNull();
});

it("returns null for finance_list_reports given a wrong shape", () => {
	expect(
		financeTool("finance_list_reports").parse([{ unrelated: "shape" }])
	).toBeNull();
});

it("parses a representative finance_search fixture", () => {
	expect(
		financeTool("finance_search").parse([STOCK_HIT_FIXTURE])
	).not.toBeNull();
});

it("returns null for finance_search given a wrong shape", () => {
	expect(
		financeTool("finance_search").parse([{ unrelated: "shape" }])
	).toBeNull();
});
