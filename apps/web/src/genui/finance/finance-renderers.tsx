import { entry, listEntry, type ToolResultRenderer } from "../tool-renderers";
import { CalendarList } from "./calendar-list";
import { CandlestickChart } from "./candlestick-chart";
import { CommodityGrid } from "./commodity-grid";
import { CompanyProfileCard } from "./company-profile-card";
import { DivergenceCard } from "./divergence-card";
import { DividendsTable } from "./dividends-table";
import { DragonTigerTable } from "./dragon-tiger-table";
import {
	CandleSchema,
	CommodityQuoteSchema,
	CompanyProfileSchema,
	DividendRowSchema,
	DragonTigerRowSchema,
	HolderRowSchema,
	HsgtRowSchema,
	IndexQuoteSchema,
	IndicatorRowSchema,
	KeyMetricsSchema,
	QuoteSchema,
	StatementRowSchema,
	TechnicalSchema,
} from "./finance-schemas";
import {
	MoneyFlowRowSchema,
	SectorConstituentSchema,
	SectorRowSchema,
	YieldPointSchema,
} from "./finance-schemas-fe6";
import { CalendarEventSchema, MacroResultSchema } from "./finance-schemas-fe7";
import {
	ForecastRowSchema,
	NewsItemSchema,
	ReportSchema,
	ResearchReportSchema,
	StockHitSchema,
	StockNewsItemSchema,
} from "./finance-schemas-fe8";
import { PredictionMarketSchema } from "./finance-schemas-fe9";
import {
	MarketSentimentSchema,
	TickerSentimentSchema,
	TrendingSentimentSchema,
} from "./finance-schemas-fe10";
import { DivergenceSchema, MarginRowSchema } from "./finance-schemas-fe11";
import { ForecastTable } from "./forecast-table";
import { HsgtTable } from "./hsgt-table";
import { IndexGrid } from "./index-grid";
import { IndicatorsTable } from "./indicators-table";
import { KeyMetricsCard } from "./key-metrics-card";
import { MacroPanel } from "./macro-panel";
import { MarginChart } from "./margin-chart";
import { MoneyFlowChart } from "./money-flow-chart";
import { NewsList } from "./news-list";
import { PredictionMarkets } from "./prediction-markets";
import { QuoteCard } from "./quote-card";
import { ReportsList } from "./reports-list";
import { ResearchList } from "./research-list";
import { SearchList } from "./search-list";
import { SectorHeatmap } from "./sector-heatmap";
import { SectorStocksList } from "./sector-stocks-list";
import { SentimentMarket } from "./sentiment-market";
import { SentimentTicker } from "./sentiment-ticker";
import { SentimentTrending } from "./sentiment-trending";
import { StatementsTable } from "./statements-table";
import { TechnicalPanel } from "./technical-panel";
import { TopHoldersTable } from "./top-holders-table";
import { YieldCurveChart } from "./yield-curve-chart";

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
// finance_financial_statements. FE-5 adds finance_top_holders /
// finance_dividends / finance_dragon_tiger / finance_hsgt_flow. FE-6 adds
// finance_money_flow / finance_sector_list / finance_sector_constituents /
// finance_yield_curve. FE-7 adds finance_macro_us / finance_macro_cn
// (macro-panel.tsx) and finance_earnings_calendar / finance_economic_calendar
// / finance_central_bank (calendar-list.tsx). FE-8 adds finance_news /
// finance_stock_news (news-list.tsx), finance_research (research-list.tsx),
// finance_earnings_forecast (forecast-table.tsx), finance_list_reports
// (reports-list.tsx), and finance_search (search-list.tsx). FE-9 adds
// finance_prediction_markets (prediction-markets.tsx), a Polymarket odds
// card. FE-10 (final) adds the Adanos market-sentiment slice:
// finance_sentiment_trending (sentiment-trending.tsx),
// finance_sentiment_ticker (sentiment-ticker.tsx), finance_sentiment_market
// (sentiment-market.tsx). FE-11 adds finance_margin (margin-chart.tsx) and
// finance_divergence (divergence-card.tsx), plus a `livePrice` flag on
// finance_prediction_markets outcomes (prediction-markets.tsx).
export const FINANCE_RENDERERS: Record<string, ToolResultRenderer> = {
	finance_central_bank: listEntry(CalendarEventSchema, (rows) => (
		<CalendarList data={rows} />
	)),
	finance_commodity: listEntry(CommodityQuoteSchema, (items) => (
		<CommodityGrid items={items} />
	)),
	finance_company_profile: entry(CompanyProfileSchema, (data) => (
		<CompanyProfileCard data={data} />
	)),
	finance_divergence: entry(DivergenceSchema, (data) => (
		<DivergenceCard data={data} />
	)),
	finance_dividends: listEntry(DividendRowSchema, (rows) => (
		<DividendsTable data={rows} />
	)),
	finance_dragon_tiger: listEntry(DragonTigerRowSchema, (rows) => (
		<DragonTigerTable data={rows} />
	)),
	finance_earnings_calendar: listEntry(CalendarEventSchema, (rows) => (
		<CalendarList data={rows} />
	)),
	finance_earnings_forecast: listEntry(ForecastRowSchema, (rows) => (
		<ForecastTable data={rows} />
	)),
	finance_economic_calendar: listEntry(CalendarEventSchema, (rows) => (
		<CalendarList data={rows} />
	)),
	finance_financial_indicators: listEntry(IndicatorRowSchema, (rows) => (
		<IndicatorsTable data={rows} />
	)),
	finance_financial_statements: listEntry(StatementRowSchema, (rows) => (
		<StatementsTable data={rows} />
	)),
	finance_hsgt_flow: listEntry(HsgtRowSchema, (rows) => (
		<HsgtTable data={rows} />
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
	finance_list_reports: listEntry(ReportSchema, (rows) => (
		<ReportsList data={rows} />
	)),
	finance_macro_cn: entry(MacroResultSchema, (data) => (
		<MacroPanel data={data} />
	)),
	finance_macro_us: entry(MacroResultSchema, (data) => (
		<MacroPanel data={data} />
	)),
	finance_margin: listEntry(MarginRowSchema, (rows) => (
		<MarginChart data={rows} />
	)),
	finance_money_flow: listEntry(MoneyFlowRowSchema, (rows) => (
		<MoneyFlowChart data={rows} />
	)),
	finance_news: listEntry(NewsItemSchema, (rows) => <NewsList data={rows} />),
	finance_prediction_markets: listEntry(PredictionMarketSchema, (markets) => (
		<PredictionMarkets markets={markets} />
	)),
	finance_quote: entry(QuoteSchema, (data) => <QuoteCard data={data} />),
	finance_research: listEntry(ResearchReportSchema, (rows) => (
		<ResearchList data={rows} />
	)),
	finance_search: listEntry(StockHitSchema, (rows) => (
		<SearchList data={rows} />
	)),
	finance_sector_constituents: listEntry(SectorConstituentSchema, (rows) => (
		<SectorStocksList data={rows} />
	)),
	finance_sector_list: listEntry(SectorRowSchema, (items) => (
		<SectorHeatmap items={items} />
	)),
	finance_sentiment_market: entry(MarketSentimentSchema, (data) => (
		<SentimentMarket data={data} />
	)),
	finance_sentiment_ticker: entry(TickerSentimentSchema, (data) => (
		<SentimentTicker data={data} />
	)),
	finance_sentiment_trending: listEntry(TrendingSentimentSchema, (rows) => (
		<SentimentTrending data={rows} />
	)),
	finance_stock_news: listEntry(StockNewsItemSchema, (rows) => (
		<NewsList data={rows} />
	)),
	finance_technical: entry(TechnicalSchema, (data) => (
		<TechnicalPanel data={data} />
	)),
	finance_top_holders: listEntry(HolderRowSchema, (rows) => (
		<TopHoldersTable data={rows} />
	)),
	finance_yield_curve: listEntry(YieldPointSchema, (data) => (
		<YieldCurveChart data={data} />
	)),
};
