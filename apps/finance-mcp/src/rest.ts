import type { Hono } from "hono";
import { getQuote } from "./core/tencent/quote";

export function registerRest(app: Hono): void {
	app.get("/api/quote", async (c) => {
		const symbol = c.req.query("symbol") ?? "";
		return c.json(await getQuote(symbol));
	});
}
