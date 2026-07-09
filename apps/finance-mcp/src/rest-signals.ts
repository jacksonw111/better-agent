import type { Context, Hono } from "hono";
import { withCache } from "./core/cache";
import { getMargin } from "./core/eastmoney/margin";
import { getDivergence } from "./core/signals/divergence";

// V4 batch: margin + price↔sentiment divergence REST routes, split into a
// new file since rest.ts / rest-extra.ts are close to the project's
// 300-line-per-file cap. Registered alongside registerRest() /
// registerRestExtra() in app.ts.

const DEFAULT_MARGIN_LIMIT = 10;
const DEFAULT_DIVERGENCE_SOURCE = "x";

async function marginHandler(c: Context) {
	const symbol = c.req.query("symbol") ?? "";
	const limit = Number(c.req.query("limit") ?? "") || DEFAULT_MARGIN_LIMIT;
	return c.json(
		await withCache(`margin:${symbol}:${limit}`, 1800, () =>
			getMargin(symbol, limit)
		)
	);
}

async function divergenceHandler(c: Context) {
	const ticker = c.req.query("ticker") ?? "";
	const source = c.req.query("source") || DEFAULT_DIVERGENCE_SOURCE;
	const apiKey =
		(c.env as { ADANOS_API_KEY?: string } | undefined)?.ADANOS_API_KEY ?? "";
	return c.json(
		await withCache(`div-signal:${ticker}:${source}`, 600, () =>
			getDivergence(ticker, source, apiKey)
		)
	);
}

export function registerRestSignals(app: Hono): void {
	app.get("/api/margin", marginHandler);
	app.get("/api/divergence", divergenceHandler);
}
