import type { Hono } from "hono";
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
}
