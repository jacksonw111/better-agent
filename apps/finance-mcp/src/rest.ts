import type { Hono } from "hono";
import { earningsCalendar } from "./core/eastmoney/earnings";
import { listReports } from "./core/eastmoney/periodic-reports";
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
}
