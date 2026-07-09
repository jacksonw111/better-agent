import { entry, listEntry, type ToolResultRenderer } from "../tool-renderers";
import { CandlestickChart } from "./candlestick-chart";
import { CommodityGrid } from "./commodity-grid";
import { CompanyProfileCard } from "./company-profile-card";
import {
	CandleSchema,
	CommodityQuoteSchema,
	CompanyProfileSchema,
	IndexQuoteSchema,
	IndicatorRowSchema,
	KeyMetricsSchema,
	QuoteSchema,
	StatementRowSchema,
	TechnicalSchema,
} from "./finance-schemas";
import { IndexGrid } from "./index-grid";
import { IndicatorsTable } from "./indicators-table";
import { KeyMetricsCard } from "./key-metrics-card";
import { QuoteCard } from "./quote-card";
import { StatementsTable } from "./statements-table";
import { TechnicalPanel } from "./technical-panel";

// Tool name → { parse, render } for the finance tool results. Spread into
// TOOL_RESULT_RENDERERS by ../tool-renderers.tsx. `listEntry` and `entry` are
// function declarations (hoisted), so this module can safely import them
// back from ../tool-renderers.tsx even though that module imports
// FINANCE_RENDERERS from here — the cycle only ever runs through hoisted
// bindings that are ready before either module's top-level code executes.
//
// FE-1: finance_index_quote + finance_commodity. FE-2 adds finance_quote +
// finance_technical here. FE-3 adds finance_kline (candlestick + volume).
// FE-4 adds the fundamentals slice: finance_key_metrics /
// finance_company_profile / finance_financial_indicators /
// finance_financial_statements.
export const FINANCE_RENDERERS: Record<string, ToolResultRenderer> = {
	finance_commodity: listEntry(CommodityQuoteSchema, (items) => (
		<CommodityGrid items={items} />
	)),
	finance_company_profile: entry(CompanyProfileSchema, (data) => (
		<CompanyProfileCard data={data} />
	)),
	finance_financial_indicators: listEntry(IndicatorRowSchema, (rows) => (
		<IndicatorsTable data={rows} />
	)),
	finance_financial_statements: listEntry(StatementRowSchema, (rows) => (
		<StatementsTable data={rows} />
	)),
	finance_index_quote: listEntry(IndexQuoteSchema, (items) => (
		<IndexGrid items={items} />
	)),
	finance_key_metrics: entry(KeyMetricsSchema, (data) => (
		<KeyMetricsCard data={data} />
	)),
	finance_kline: listEntry(CandleSchema, (candles) => (
		<CandlestickChart candles={candles} />
	)),
	finance_quote: entry(QuoteSchema, (data) => <QuoteCard data={data} />),
	finance_technical: entry(TechnicalSchema, (data) => (
		<TechnicalPanel data={data} />
	)),
};
