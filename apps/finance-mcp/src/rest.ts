import type { Hono } from "hono";
import { centralBank } from "./core/eastmoney/central-bank";
import { earningsCalendar } from "./core/eastmoney/earnings";
import { listReports } from "./core/eastmoney/periodic-reports";
import { economicCalendar } from "./core/finnhub/economic";
import { getKline } from "./core/tencent/kline";
import { getQuote } from "./core/tencent/quote";

export function registerRest(app: Hono): void {
	app.get("/api/quote", async (c) => {
		const symbol = c.req.query("symbol") ?? "";
		return c.json(await getQuote(symbol));
	});

	app.get("/api/kline", async (c) => {
		const symbol = c.req.query("symbol") ?? "";
		const p = c.req.query("period");
		const period = p === "week" || p === "month" ? p : "day";
		const limit = Number(c.req.query("limit") ?? "240") || 240;
		return c.json(await getKline(symbol, period, limit));
	});

	app.get("/api/reports", async (c) => {
		const symbol = c.req.query("symbol") ?? "";
		const years = Number(c.req.query("years") ?? "2") || 2;
		return c.json(await listReports(symbol, years));
	});

	app.get("/api/calendar/earnings", async (c) => {
		const m = c.req.query("market");
		const market = m === "us" || m === "hk" ? m : "a";
		const date = c.req.query("date") ?? "";
		return c.json(await earningsCalendar(market, date));
	});

	app.get("/api/calendar/economic", async (c) => {
		const from = c.req.query("from") ?? "";
		const to = c.req.query("to") ?? "";
		const country = c.req.query("country") ?? undefined;
		const key =
			(c.env as { FINNHUB_API_KEY?: string } | undefined)?.FINNHUB_API_KEY ??
			"";
		return c.json(await economicCalendar(from, to, key, country));
	});

	app.get("/api/calendar/central-bank", async (c) => {
		const market = c.req.query("market") === "us" ? "us" : "a";
		return c.json(await centralBank(market));
	});
}
