import type { Context, Hono } from "hono";
import {
	sentimentMarket,
	sentimentTicker,
	sentimentTrending,
} from "./core/adanos/sentiment";
import { withCache } from "./core/cache";

// Adanos market-sentiment REST routes (trending, ticker, market), split into
// its own file rather than rest.ts / rest-extra.ts since rest.ts is at the
// project's 300-line-per-file cap. Registered alongside registerRest() /
// registerRestExtra() in app.ts.

const DEFAULT_TRENDING_LIMIT = 10;

function adanosKey(c: Context): string {
	return (
		(c.env as { ADANOS_API_KEY?: string } | undefined)?.ADANOS_API_KEY ?? ""
	);
}

async function sentimentTrendingHandler(c: Context) {
	const source = c.req.query("source");
	const asset = c.req.query("asset");
	const limit = Number(c.req.query("limit") ?? "") || DEFAULT_TRENDING_LIMIT;
	const cacheKey = `sent-trend:${source ?? ""}:${asset ?? ""}:${limit}`;
	return c.json(
		await withCache(cacheKey, 300, () =>
			sentimentTrending(source, asset, limit, adanosKey(c))
		)
	);
}

async function sentimentTickerHandler(c: Context) {
	const ticker = c.req.query("ticker") ?? "";
	const source = c.req.query("source");
	const asset = c.req.query("asset");
	const cacheKey = `sent-ticker:${ticker}:${source ?? ""}:${asset ?? ""}`;
	return c.json(
		await withCache(cacheKey, 300, () =>
			sentimentTicker(ticker, source, asset, adanosKey(c))
		)
	);
}

async function sentimentMarketHandler(c: Context) {
	const source = c.req.query("source");
	const asset = c.req.query("asset");
	const cacheKey = `sent-market:${source ?? ""}:${asset ?? ""}`;
	return c.json(
		await withCache(cacheKey, 300, () =>
			sentimentMarket(source, asset, adanosKey(c))
		)
	);
}

export function registerRestSentiment(app: Hono): void {
	app.get("/api/sentiment/trending", sentimentTrendingHandler);
	app.get("/api/sentiment/ticker", sentimentTickerHandler);
	app.get("/api/sentiment/market", sentimentMarketHandler);
}
