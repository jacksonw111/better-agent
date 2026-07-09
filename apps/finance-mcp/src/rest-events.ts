import type { Context, Hono } from "hono";
import { withCache } from "./core/cache";
import { getBlockTrades } from "./core/eastmoney/block-trades";
import { getInsiderTrades } from "./core/eastmoney/insider";
import { getSuspension } from "./core/eastmoney/suspension";

// V7 batch: market-events REST routes (大宗交易/高管增减持/停复牌), split out
// of rest.ts (which is at the project's 300-line-per-file cap) — same
// pattern as rest-data.ts / rest-extra.ts. Registered alongside
// registerRest() in app.ts.

const DEFAULT_BLOCK_TRADE_LIMIT = 20;
const DEFAULT_INSIDER_LIMIT = 20;
const DEFAULT_SUSPENSION_LIMIT = 30;

function optionalQuery(c: Context, key: string): string | undefined {
	const value = c.req.query(key);
	return value && value.length > 0 ? value : undefined;
}

async function blockTradesHandler(c: Context) {
	const symbol = optionalQuery(c, "symbol");
	const limit = Number(c.req.query("limit") ?? "") || DEFAULT_BLOCK_TRADE_LIMIT;
	return c.json(
		await withCache(`block:${symbol ?? "all"}:${limit}`, 1800, () =>
			getBlockTrades(symbol, limit)
		)
	);
}

async function insiderTradesHandler(c: Context) {
	const symbol = optionalQuery(c, "symbol");
	const limit = Number(c.req.query("limit") ?? "") || DEFAULT_INSIDER_LIMIT;
	return c.json(
		await withCache(`insider:${symbol ?? "all"}:${limit}`, 1800, () =>
			getInsiderTrades(symbol, limit)
		)
	);
}

async function suspensionHandler(c: Context) {
	const limit = Number(c.req.query("limit") ?? "") || DEFAULT_SUSPENSION_LIMIT;
	return c.json(
		await withCache(`suspend:${limit}`, 1800, () => getSuspension(limit))
	);
}

export function registerRestEvents(app: Hono): void {
	app.get("/api/block-trades", blockTradesHandler);
	app.get("/api/insider", insiderTradesHandler);
	app.get("/api/suspension", suspensionHandler);
}
