import type { Context, Hono } from "hono";
import { withCache } from "./core/cache";
import { getAnnouncements } from "./core/cninfo/announcements";
import { getInvestorQa } from "./core/cninfo/irm";
import { getHotConcepts } from "./core/eastmoney/hot-concept";
import {
	getLimitUpPool,
	getLimitUpSentiment,
	type LimitUpPoolKind,
} from "./core/eastmoney/limit-up";
import { getStockBoards } from "./core/eastmoney/stock-boards";
import { getKalshiMarkets } from "./core/kalshi/markets";
import { getPredictionHistory } from "./core/polymarket/history";
import { getIndustryNews } from "./core/rss/industry-news";
import { getSecFilings } from "./core/sec/edgar";
import { getXbrlFacts } from "./core/sec/xbrl";
import { getOptionContracts, getOptionQuote } from "./core/sina/options";
import { parseSymbol } from "./core/symbol";
import { getThsHotList } from "./core/ths/hot-list";
import { getStrongStocks } from "./core/ths/hot-reason";
import { getLimitUpReasons } from "./core/ths/limit-up-reasons";
import { getAnalystRatings } from "./core/yahoo/analyst";
import { getInstitutionalHolders } from "./core/yahoo/holders";
import { getUsOptions } from "./core/yahoo/options";

// V6 batch REST routes (打板 + 舆情 + A股扩展 + 美股增强 + 行业新闻),
// registered alongside the other registerRest*() calls in app.ts. Cache keys
// and TTLs mirror the MCP handlers in tools-impl-{limitup,buzz,cnx,global}.ts.

const POOL_TTL = 120;
const REASONS_TTL = 300;
const HOT_TTL = 300;
const STRONG_TTL = 600;
const QA_TTL = 600;
const ANN_TTL = 1800;
const HOUR_TTL = 3600;
const OPTION_QUOTE_TTL = 60;
const US_OPTIONS_TTL = 300;
const RSS_TTL = 900;
const DEFAULT_LIMIT = 20;
const POOL_KINDS: readonly LimitUpPoolKind[] = ["zt", "zb", "dt", "yzt"];

function q(c: Context, key: string): string {
	return c.req.query(key) ?? "";
}

function qNum(c: Context, key: string, fallback: number): number {
	return Number(c.req.query(key) ?? "") || fallback;
}

function qCode(c: Context): string {
	return parseSymbol(q(c, "symbol")).code;
}

async function limitUpPoolHandler(c: Context) {
	const raw = q(c, "pool");
	const pool = POOL_KINDS.find((kind) => kind === raw) ?? "zt";
	const date = q(c, "date");
	return c.json(
		await withCache(`limitup:${pool}:${date}`, POOL_TTL, () =>
			getLimitUpPool(pool, date)
		)
	);
}

async function limitUpReasonsHandler(c: Context) {
	const date = q(c, "date");
	return c.json(
		await withCache(`limitup-reasons:${date}`, REASONS_TTL, () =>
			getLimitUpReasons(date)
		)
	);
}

async function limitUpSentimentHandler(c: Context) {
	const date = q(c, "date");
	return c.json(
		await withCache(`limitup-sentiment:${date}`, POOL_TTL, () =>
			getLimitUpSentiment(date)
		)
	);
}

async function hotListHandler(c: Context) {
	const period = q(c, "period") === "day" ? "day" : "hour";
	const limit = qNum(c, "limit", DEFAULT_LIMIT);
	return c.json(
		await withCache(`ths-hot:${period}:${limit}`, HOT_TTL, () =>
			getThsHotList(period, limit)
		)
	);
}

async function strongStocksHandler(c: Context) {
	const date = q(c, "date");
	return c.json(
		await withCache(`strong-stocks:${date}`, STRONG_TTL, () =>
			getStrongStocks(date)
		)
	);
}

async function hotConceptsHandler(c: Context) {
	const code = qCode(c);
	return c.json(
		await withCache(`hot-concepts:${code}`, STRONG_TTL, () =>
			getHotConcepts(code)
		)
	);
}

async function investorQaHandler(c: Context) {
	const code = qCode(c);
	const limit = qNum(c, "limit", DEFAULT_LIMIT);
	return c.json(
		await withCache(`investor-qa:${code}:${limit}`, QA_TTL, () =>
			getInvestorQa(code, limit)
		)
	);
}

async function announcementsHandler(c: Context) {
	const code = qCode(c);
	const limit = qNum(c, "limit", DEFAULT_LIMIT);
	const search = q(c, "search");
	return c.json(
		await withCache(`announcements:${code}:${limit}:${search}`, ANN_TTL, () =>
			getAnnouncements(code, limit, search)
		)
	);
}

async function stockBoardsHandler(c: Context) {
	const code = qCode(c);
	return c.json(
		await withCache(`stock-boards:${code}`, HOUR_TTL, () =>
			getStockBoards(code)
		)
	);
}

async function optionContractsHandler(c: Context) {
	const underlying = q(c, "underlying") || "510050";
	const kind = q(c, "kind") === "put" ? "put" : "call";
	return c.json(
		await withCache(`option-contracts:${underlying}:${kind}`, HOUR_TTL, () =>
			getOptionContracts(underlying, kind)
		)
	);
}

async function optionQuoteHandler(c: Context) {
	const code = q(c, "code");
	return c.json(
		await withCache(`option-quote:${code}`, OPTION_QUOTE_TTL, () =>
			getOptionQuote(code)
		)
	);
}

async function usOptionsHandler(c: Context) {
	const ticker = q(c, "ticker").toUpperCase();
	const expiration = qNum(c, "expiration", 0);
	return c.json(
		await withCache(`us-options:${ticker}:${expiration}`, US_OPTIONS_TTL, () =>
			getUsOptions(ticker, expiration || undefined)
		)
	);
}

async function analystHandler(c: Context) {
	const ticker = q(c, "ticker").toUpperCase();
	return c.json(
		await withCache(`analyst:${ticker}`, HOUR_TTL, () =>
			getAnalystRatings(ticker)
		)
	);
}

async function holdersHandler(c: Context) {
	const ticker = q(c, "ticker").toUpperCase();
	return c.json(
		await withCache(`inst-holders:${ticker}`, HOUR_TTL, () =>
			getInstitutionalHolders(ticker)
		)
	);
}

async function secFilingsHandler(c: Context) {
	const ticker = q(c, "ticker").toUpperCase();
	const formType = q(c, "form_type");
	const limit = qNum(c, "limit", DEFAULT_LIMIT);
	return c.json(
		await withCache(
			`sec-filings:${ticker}:${formType}:${limit}`,
			HOUR_TTL,
			() => getSecFilings(ticker, formType, limit)
		)
	);
}

async function secFactsHandler(c: Context) {
	const ticker = q(c, "ticker").toUpperCase();
	const metricsRaw = q(c, "metrics");
	const metrics = metricsRaw
		.split(",")
		.map((m) => m.trim())
		.filter((m) => m.length > 0);
	return c.json(
		await withCache(`sec-facts:${ticker}:${metricsRaw}`, HOUR_TTL, () =>
			getXbrlFacts(ticker, metrics)
		)
	);
}

async function kalshiHandler(c: Context) {
	const series = q(c, "series");
	const query = q(c, "query");
	const limit = qNum(c, "limit", DEFAULT_LIMIT);
	return c.json(
		await withCache(`kalshi:${series}:${query}:${limit}`, HOT_TTL, () =>
			getKalshiMarkets(series, query, limit)
		)
	);
}

async function predictionHistoryHandler(c: Context) {
	const query = q(c, "query");
	const interval = q(c, "interval") || "1w";
	return c.json(
		await withCache(`pred-history:${query}:${interval}`, STRONG_TTL, () =>
			getPredictionHistory(query, interval)
		)
	);
}

async function industryNewsHandler(c: Context) {
	const sector = q(c, "sector");
	const limit = qNum(c, "limit", DEFAULT_LIMIT);
	return c.json(
		await withCache(`industry-news:${sector}:${limit}`, RSS_TTL, () =>
			getIndustryNews(sector, limit)
		)
	);
}

export function registerRestV6(app: Hono): void {
	app.get("/api/limit-up/pool", limitUpPoolHandler);
	app.get("/api/limit-up/reasons", limitUpReasonsHandler);
	app.get("/api/limit-up/sentiment", limitUpSentimentHandler);
	app.get("/api/hot-list", hotListHandler);
	app.get("/api/strong-stocks", strongStocksHandler);
	app.get("/api/hot-concepts", hotConceptsHandler);
	app.get("/api/investor-qa", investorQaHandler);
	app.get("/api/announcements", announcementsHandler);
	app.get("/api/stock-boards", stockBoardsHandler);
	app.get("/api/option-contracts", optionContractsHandler);
	app.get("/api/option-quote", optionQuoteHandler);
	app.get("/api/us-options", usOptionsHandler);
	app.get("/api/analyst-ratings", analystHandler);
	app.get("/api/institutional-holders", holdersHandler);
	app.get("/api/sec-filings", secFilingsHandler);
	app.get("/api/sec-facts", secFactsHandler);
	app.get("/api/kalshi", kalshiHandler);
	app.get("/api/prediction-history", predictionHistoryHandler);
	app.get("/api/industry-news", industryNewsHandler);
}
