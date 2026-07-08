import type { Context, Hono } from "hono";
import { withCache } from "./core/cache";
import { centralBank } from "./core/eastmoney/central-bank";
import { earningsCalendar } from "./core/eastmoney/earnings";
import { listReports } from "./core/eastmoney/periodic-reports";
import { economicCalendar } from "./core/finnhub/economic";
import { getKline } from "./core/tencent/kline";
import { getQuote } from "./core/tencent/quote";

const DEFAULT_KLINE_LIMIT = 240;
const DEFAULT_REPORT_YEARS = 2;

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
	const key =
		(c.env as { FINNHUB_API_KEY?: string } | undefined)?.FINNHUB_API_KEY ?? "";
	return c.json(
		await withCache(`econ:${from}:${to}:${country ?? "all"}`, 1800, () =>
			economicCalendar(from, to, key, country)
		)
	);
}

async function centralBankHandler(c: Context) {
	const market = c.req.query("market") === "us" ? "us" : "a";
	return c.json(
		await withCache(`cb:${market}`, 1800, () => centralBank(market))
	);
}

export function registerRest(app: Hono): void {
	app.get("/api/quote", quoteHandler);
	app.get("/api/kline", klineHandler);
	app.get("/api/reports", reportsHandler);
	app.get("/api/calendar/earnings", earningsHandler);
	app.get("/api/calendar/economic", economicHandler);
	app.get("/api/calendar/central-bank", centralBankHandler);
}
