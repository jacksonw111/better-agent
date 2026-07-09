import type { Context, Hono } from "hono";
import { withCache } from "./core/cache";
import { getDividends } from "./core/eastmoney/dividends";
import { getDragonTiger } from "./core/eastmoney/dragon-tiger";
import { getTopHolders } from "./core/eastmoney/top-holders";

// V3 batch: free A-share REST routes (dividends, dragon-tiger, top holders),
// split out of rest.ts (which is at the project's 300-line-per-file cap) —
// same pattern as tools-impl-market.ts / tool-defs-market.ts. Registered
// alongside registerRest() in app.ts.

const DEFAULT_DIVIDENDS_LIMIT = 10;
const DEFAULT_DRAGON_TIGER_LIMIT = 30;

async function dividendsHandler(c: Context) {
	const symbol = c.req.query("symbol") ?? "";
	const limit = Number(c.req.query("limit") ?? "") || DEFAULT_DIVIDENDS_LIMIT;
	return c.json(
		await withCache(`div:${symbol}:${limit}`, 3600, () =>
			getDividends(symbol, limit)
		)
	);
}

async function dragonTigerHandler(c: Context) {
	const date = c.req.query("date") ?? "";
	const limit =
		Number(c.req.query("limit") ?? "") || DEFAULT_DRAGON_TIGER_LIMIT;
	return c.json(
		await withCache(`lhb:${date || "latest"}:${limit}`, 1800, () =>
			getDragonTiger(date, limit)
		)
	);
}

async function topHoldersHandler(c: Context) {
	const symbol = c.req.query("symbol") ?? "";
	return c.json(
		await withCache(`holders:${symbol}`, 3600, () => getTopHolders(symbol))
	);
}

export function registerRestExtra(app: Hono): void {
	app.get("/api/dividends", dividendsHandler);
	app.get("/api/dragon-tiger", dragonTigerHandler);
	app.get("/api/top-holders", topHoldersHandler);
}
