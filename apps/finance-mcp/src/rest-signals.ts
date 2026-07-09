import type { Context, Hono } from "hono";
import { sentimentCompare } from "./core/adanos/compare";
import { withCache } from "./core/cache";
import { getCnHot } from "./core/eastmoney/cn-hot";
import { getHolderCount } from "./core/eastmoney/holder-count";
import { getMargin } from "./core/eastmoney/margin";
import { getDivergence } from "./core/signals/divergence";

// V4/V5 batch: margin + price↔sentiment divergence + sentiment compare +
// 股东户数 + A股人气榜 REST routes, split into a new file since rest.ts /
// rest-extra.ts are close to the project's 300-line-per-file cap. Registered
// alongside registerRest() / registerRestExtra() in app.ts.

const DEFAULT_MARGIN_LIMIT = 10;
const DEFAULT_DIVERGENCE_SOURCE = "x";
const DEFAULT_CN_HOT_LIMIT = 20;

function parseTickers(raw: string): string[] {
	return raw
		.split(",")
		.map((t) => t.trim())
		.filter((t) => t.length > 0);
}

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

function adanosKey(c: Context): string {
	return (
		(c.env as { ADANOS_API_KEY?: string } | undefined)?.ADANOS_API_KEY ?? ""
	);
}

async function sentimentCompareHandler(c: Context) {
	const tickersRaw = c.req.query("tickers") ?? "";
	const tickers = parseTickers(tickersRaw);
	const source = c.req.query("source");
	const asset = c.req.query("asset");
	const cacheKey = `sent-cmp:${tickersRaw}:${source ?? ""}:${asset ?? ""}`;
	return c.json(
		await withCache(cacheKey, 300, () =>
			sentimentCompare(tickers, source, asset, adanosKey(c))
		)
	);
}

async function holderCountHandler(c: Context) {
	const symbol = c.req.query("symbol") ?? "";
	return c.json(
		await withCache(`holdercount:${symbol}`, 3600, () => getHolderCount(symbol))
	);
}

async function cnHotHandler(c: Context) {
	const limit = Number(c.req.query("limit") ?? "") || DEFAULT_CN_HOT_LIMIT;
	return c.json(await withCache(`cnhot:${limit}`, 300, () => getCnHot(limit)));
}

export function registerRestSignals(app: Hono): void {
	app.get("/api/margin", marginHandler);
	app.get("/api/divergence", divergenceHandler);
	app.get("/api/sentiment/compare", sentimentCompareHandler);
	app.get("/api/holder-count", holderCountHandler);
	app.get("/api/cn-hot", cnHotHandler);
}
