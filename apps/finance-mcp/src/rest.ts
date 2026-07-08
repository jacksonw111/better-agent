import type { Context, Hono } from "hono";
import { withCache } from "./core/cache";
import { centralBank } from "./core/eastmoney/central-bank";
import { earningsCalendar } from "./core/eastmoney/earnings";
import { getEarningsForecast } from "./core/eastmoney/forecast";
import { getFinancialIndicators } from "./core/eastmoney/indicators";
import { listReports } from "./core/eastmoney/periodic-reports";
import { getCompanyProfile } from "./core/eastmoney/profile";
import { getStockResearch } from "./core/eastmoney/research";
import { searchAStocks } from "./core/eastmoney/search";
import { getStatements } from "./core/eastmoney/statements";
import { getKeyMetrics } from "./core/eastmoney/valuation";
import { economicCalendar } from "./core/fred/economic";
import { getTechnical } from "./core/technical/indicators";
import { getCommodities } from "./core/tencent/commodity";
import { getIndices } from "./core/tencent/indices";
import { getKline } from "./core/tencent/kline";
import { getQuote } from "./core/tencent/quote";

const DEFAULT_KLINE_LIMIT = 240;
const DEFAULT_REPORT_YEARS = 2;
const DEFAULT_STATEMENT_PERIODS = 4;
const DEFAULT_INDICATOR_PERIODS = 8;

async function quoteHandler(c: Context) {
	const symbol = c.req.query("symbol") ?? "";
	return c.json(await withCache(`quote:${symbol}`, 5, () => getQuote(symbol)));
}

async function klineHandler(c: Context) {
	const symbol = c.req.query("symbol") ?? "";
	const p = c.req.query("period");
	const period = p === "week" || p === "month" ? p : "day";
	const limit = Number(c.req.query("limit") ?? "") || DEFAULT_KLINE_LIMIT;
	return c.json(
		await withCache(`kline:${symbol}:${period}:${limit}`, 300, () =>
			getKline(symbol, period, limit)
		)
	);
}

async function reportsHandler(c: Context) {
	const symbol = c.req.query("symbol") ?? "";
	const years = Number(c.req.query("years") ?? "") || DEFAULT_REPORT_YEARS;
	return c.json(
		await withCache(`reports:${symbol}:${years}`, 3600, () =>
			listReports(symbol, years)
		)
	);
}

async function earningsHandler(c: Context) {
	const m = c.req.query("market");
	const market = m === "us" || m === "hk" ? m : "a";
	const date = c.req.query("date") ?? "";
	return c.json(
		await withCache(`earn:${market}:${date}`, 1800, () =>
			earningsCalendar(market, date)
		)
	);
}

async function economicHandler(c: Context) {
	const from = c.req.query("from") ?? "";
	const to = c.req.query("to") ?? "";
	const country = c.req.query("country") ?? undefined;
	const all = c.req.query("all") === "true";
	const event = c.req.query("event") || undefined;
	const key =
		(c.env as { FRED_API_KEY?: string } | undefined)?.FRED_API_KEY ?? "";
	const cacheKey = `econ:${from}:${to}:${country ?? "all"}:${all ? "all" : "key"}:${event ?? ""}`;
	return c.json(
		await withCache(cacheKey, 1800, () =>
			economicCalendar(from, to, key, country, { all, event })
		)
	);
}

async function centralBankHandler(c: Context) {
	const market = c.req.query("market") === "us" ? "us" : "a";
	return c.json(
		await withCache(`cb:${market}`, 1800, () => centralBank(market))
	);
}

async function keyMetricsHandler(c: Context) {
	const symbol = c.req.query("symbol") ?? "";
	return c.json(
		await withCache(`metrics:${symbol}`, 300, () => getKeyMetrics(symbol))
	);
}

async function companyProfileHandler(c: Context) {
	const symbol = c.req.query("symbol") ?? "";
	return c.json(
		await withCache(`profile:${symbol}`, 86_400, () =>
			getCompanyProfile(symbol)
		)
	);
}

async function financialStatementsHandler(c: Context) {
	const symbol = c.req.query("symbol") ?? "";
	const statement = c.req.query("statement") ?? "";
	const periods =
		Number(c.req.query("periods") ?? "") || DEFAULT_STATEMENT_PERIODS;
	return c.json(
		await withCache(`fin:${symbol}:${statement}:${periods}`, 3600, () =>
			getStatements(symbol, statement, periods)
		)
	);
}

async function financialIndicatorsHandler(c: Context) {
	const symbol = c.req.query("symbol") ?? "";
	const periods =
		Number(c.req.query("periods") ?? "") || DEFAULT_INDICATOR_PERIODS;
	return c.json(
		await withCache(`ind:${symbol}:${periods}`, 3600, () =>
			getFinancialIndicators(symbol, periods)
		)
	);
}

async function searchHandler(c: Context) {
	const query = c.req.query("query") ?? "";
	return c.json(
		await withCache(`search:${query}`, 3600, () => searchAStocks(query))
	);
}

async function researchHandler(c: Context) {
	const symbol = c.req.query("symbol") ?? "";
	return c.json(
		await withCache(`research:${symbol}`, 3600, () => getStockResearch(symbol))
	);
}

async function forecastHandler(c: Context) {
	const symbol = c.req.query("symbol") ?? "";
	return c.json(
		await withCache(`forecast:${symbol}`, 3600, () =>
			getEarningsForecast(symbol)
		)
	);
}

async function indicesHandler(c: Context) {
	const region = c.req.query("region") ?? "all";
	return c.json(
		await withCache(`indices:${region}`, 30, () => getIndices(region))
	);
}

async function commodityHandler(c: Context) {
	return c.json(await withCache("commodity", 30, () => getCommodities()));
}

async function technicalHandler(c: Context) {
	const symbol = c.req.query("symbol") ?? "";
	const p = c.req.query("period");
	const period = p === "week" || p === "month" ? p : "day";
	return c.json(
		await withCache(`tech:${symbol}:${period}`, 60, () =>
			getTechnical(symbol, period)
		)
	);
}

export function registerRest(app: Hono): void {
	app.get("/api/quote", quoteHandler);
	app.get("/api/kline", klineHandler);
	app.get("/api/reports", reportsHandler);
	app.get("/api/calendar/earnings", earningsHandler);
	app.get("/api/calendar/economic", economicHandler);
	app.get("/api/calendar/central-bank", centralBankHandler);
	app.get("/api/metrics", keyMetricsHandler);
	app.get("/api/profile", companyProfileHandler);
	app.get("/api/financials", financialStatementsHandler);
	app.get("/api/indicators", financialIndicatorsHandler);
	app.get("/api/search", searchHandler);
	app.get("/api/research", researchHandler);
	app.get("/api/forecast", forecastHandler);
	app.get("/api/indices", indicesHandler);
	app.get("/api/commodity", commodityHandler);
	app.get("/api/technical", technicalHandler);
}
