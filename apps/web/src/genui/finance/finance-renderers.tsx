import { entry, listEntry, type ToolResultRenderer } from "../tool-renderers";
import { BlockTradesTable } from "./block-trades-table";
import { CalendarList } from "./calendar-list";
import { CandlestickChart } from "./candlestick-chart";
import { CnHotList } from "./cn-hot-list";
import { CommodityGrid } from "./commodity-grid";
import { CompanyProfileCard } from "./company-profile-card";
import { ConvertibleBondsTable } from "./convertible-bonds-table";
import { DivergenceCard } from "./divergence-card";
import { DividendsTable } from "./dividends-table";
import { DragonTigerTable } from "./dragon-tiger-table";
import { EtfList } from "./etf-list";
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
import {
	CnHotRowSchema,
	HolderCountRowSchema,
	SentimentCompareSchema,
} from "./finance-schemas-fe12";
import {
	ConvertibleBondRowSchema,
	IpoRowSchema,
	LockupRowSchema,
	PreannounceRowSchema,
} from "./finance-schemas-fe13";
import {
	EtfRowSchema,
	IndexWeightRowSchema,
	OptionRowSchema,
} from "./finance-schemas-fe14";
import {
	BlockTradeRowSchema,
	InsiderRowSchema,
	SuspensionRowSchema,
} from "./finance-schemas-fe15";
import { ForecastTable } from "./forecast-table";
import { HolderCountChart } from "./holder-count-chart";
import { IndexGrid } from "./index-grid";
import { IndexWeights } from "./index-weights";
import { IndicatorsTable } from "./indicators-table";
import { InsiderTable } from "./insider-table";
import { IpoTable } from "./ipo-table";
import { KeyMetricsCard } from "./key-metrics-card";
import { lazyChart } from "./lazy-chart";
import { LockupTable } from "./lockup-table";
import { MarginChart } from "./margin-chart";
import { NewsList } from "./news-list";
import { OptionChain } from "./option-chain";
import { PreannounceTable } from "./preannounce-table";
import { PredictionMarkets } from "./prediction-markets";
import { QuoteCard } from "./quote-card";
import { ReportsList } from "./reports-list";
import { ResearchList } from "./research-list";
import { SearchList } from "./search-list";
import { SectorHeatmap } from "./sector-heatmap";
import { SectorStocksList } from "./sector-stocks-list";
import { SentimentCompare } from "./sentiment-compare";
import { SentimentMarket } from "./sentiment-market";
import { SentimentTicker } from "./sentiment-ticker";
import { SentimentTrending } from "./sentiment-trending";
import { StatementsTable } from "./statements-table";
import { SuspensionTable } from "./suspension-table";
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
// finance_prediction_markets outcomes (prediction-markets.tsx). FE-12 adds
// finance_sentiment_compare (sentiment-compare.tsx), finance_holder_count
// (holder-count-chart.tsx), and finance_cn_hot (cn-hot-list.tsx). FE-13 adds
// finance_earnings_preannounce (preannounce-table.tsx), finance_lockup
// (lockup-table.tsx), finance_convertible_bonds
// (convertible-bonds-table.tsx), and finance_ipo (ipo-table.tsx). FE-14
// (V6b) adds finance_index_weights (index-weights.tsx), finance_etf_list
// (etf-list.tsx), and finance_option_chain (option-chain.tsx). FE-15 (V7)
// adds finance_block_trades (block-trades-table.tsx), finance_insider_trades
// (insider-table.tsx), and finance_suspension (suspension-table.tsx).
// Phase 3 Task 6 ports finance_index_weights and finance_sentiment_compare
// onto the `RankList` archetype (index-weights.tsx / sentiment-compare.tsx)
// — neither imports recharts any more, so both moved from the `lazyChart`
// map below to a direct import above alongside their RankList siblings.
// Phase 3 Task 9a ports finance_sentiment_market / finance_sentiment_ticker
// onto the `StatPanel` archetype (sentiment-market.tsx / sentiment-ticker.tsx)
// — sentiment-ticker.tsx's daily trend is now a `Sparkline` (pure SVG)
// instead of a recharts `LineChart`, so it moved to a direct import too.
// Remaining recharts-backed cards stay lazy, loaded on demand so recharts
// stays out of the eager chat bundle (see lazy-chart.tsx).
const HsgtTable = lazyChart(() =>
	import("./hsgt-table").then((m) => ({ default: m.HsgtTable }))
);
const MacroPanel = lazyChart(() =>
	import("./macro-panel").then((m) => ({ default: m.MacroPanel }))
);
const MoneyFlowChart = lazyChart(() =>
	import("./money-flow-chart").then((m) => ({ default: m.MoneyFlowChart }))
);
export const FINANCE_RENDERERS: Record<string, ToolResultRenderer> = {
	finance_block_trades: listEntry(BlockTradeRowSchema, (rows) => (
		<BlockTradesTable data={rows} />
	)),
	finance_central_bank: listEntry(CalendarEventSchema, (rows) => (
		<CalendarList data={rows} />
	)),
	finance_cn_hot: listEntry(CnHotRowSchema, (rows) => (
		<CnHotList data={rows} />
	)),
	finance_commodity: listEntry(CommodityQuoteSchema, (items) => (
		<CommodityGrid items={items} />
	)),
	finance_company_profile: entry(CompanyProfileSchema, (data) => (
		<CompanyProfileCard data={data} />
	)),
	finance_convertible_bonds: listEntry(ConvertibleBondRowSchema, (rows) => (
		<ConvertibleBondsTable data={rows} />
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
	finance_earnings_preannounce: listEntry(PreannounceRowSchema, (rows) => (
		<PreannounceTable data={rows} />
	)),
	finance_economic_calendar: listEntry(CalendarEventSchema, (rows) => (
		<CalendarList data={rows} />
	)),
	finance_etf_list: listEntry(EtfRowSchema, (rows) => <EtfList data={rows} />),
	finance_financial_indicators: listEntry(IndicatorRowSchema, (rows) => (
		<IndicatorsTable data={rows} />
	)),
	finance_financial_statements: listEntry(StatementRowSchema, (rows) => (
		<StatementsTable data={rows} />
	)),
	finance_holder_count: listEntry(HolderCountRowSchema, (rows) => (
		<HolderCountChart data={rows} />
	)),
	finance_hsgt_flow: listEntry(HsgtRowSchema, (rows) => (
		<HsgtTable data={rows} />
	)),
	finance_index_quote: listEntry(IndexQuoteSchema, (items) => (
		<IndexGrid items={items} />
	)),
	finance_index_weights: listEntry(IndexWeightRowSchema, (rows) => (
		<IndexWeights data={rows} />
	)),
	finance_insider_trades: listEntry(InsiderRowSchema, (rows) => (
		<InsiderTable data={rows} />
	)),
	finance_ipo: listEntry(IpoRowSchema, (rows) => <IpoTable data={rows} />),
	finance_key_metrics: entry(KeyMetricsSchema, (data) => (
		<KeyMetricsCard data={data} />
	)),
	finance_kline: listEntry(CandleSchema, (candles) => (
		<CandlestickChart candles={candles} />
	)),
	finance_list_reports: listEntry(ReportSchema, (rows) => (
		<ReportsList data={rows} />
	)),
	finance_lockup: listEntry(LockupRowSchema, (rows) => (
		<LockupTable data={rows} />
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
	finance_option_chain: listEntry(OptionRowSchema, (rows) => (
		<OptionChain data={rows} />
	)),
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
	finance_sentiment_compare: listEntry(SentimentCompareSchema, (rows) => (
		<SentimentCompare data={rows} />
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
	finance_suspension: listEntry(SuspensionRowSchema, (rows) => (
		<SuspensionTable data={rows} />
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
