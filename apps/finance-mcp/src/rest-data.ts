import type { Context, Hono } from "hono";
import { withCache } from "./core/cache";
import { getConvertibleBonds } from "./core/eastmoney/convertible";
import { getIpo } from "./core/eastmoney/ipo";
import { getLockup } from "./core/eastmoney/lockup";
import { getPreannounce } from "./core/eastmoney/preannounce";

// V6a batch: event-data REST routes (业绩预告/限售解禁/可转债/新股IPO), split
// out of rest.ts (which is at the project's 300-line-per-file cap) — same
// pattern as rest-extra.ts. Registered alongside registerRest() in app.ts.

const DEFAULT_PREANNOUNCE_LIMIT = 20;
const DEFAULT_LOCKUP_LIMIT = 20;
const DEFAULT_CONVERTIBLE_LIMIT = 30;
const DEFAULT_IPO_LIMIT = 20;

function optionalQuery(c: Context, key: string): string | undefined {
	const value = c.req.query(key);
	return value && value.length > 0 ? value : undefined;
}

async function preannounceHandler(c: Context) {
	const symbol = optionalQuery(c, "symbol");
	const limit = Number(c.req.query("limit") ?? "") || DEFAULT_PREANNOUNCE_LIMIT;
	return c.json(
		await withCache(`preann:${symbol ?? "all"}:${limit}`, 1800, () =>
			getPreannounce(symbol, limit)
		)
	);
}

async function lockupHandler(c: Context) {
	const symbol = optionalQuery(c, "symbol");
	const limit = Number(c.req.query("limit") ?? "") || DEFAULT_LOCKUP_LIMIT;
	return c.json(
		await withCache(`lockup:${symbol ?? "up"}:${limit}`, 3600, () =>
			getLockup(symbol, limit)
		)
	);
}

async function convertibleBondsHandler(c: Context) {
	const limit = Number(c.req.query("limit") ?? "") || DEFAULT_CONVERTIBLE_LIMIT;
	return c.json(
		await withCache(`cbonds:${limit}`, 3600, () => getConvertibleBonds(limit))
	);
}

async function ipoHandler(c: Context) {
	const limit = Number(c.req.query("limit") ?? "") || DEFAULT_IPO_LIMIT;
	return c.json(await withCache(`ipo:${limit}`, 1800, () => getIpo(limit)));
}

export function registerRestData(app: Hono): void {
	app.get("/api/preannounce", preannounceHandler);
	app.get("/api/lockup", lockupHandler);
	app.get("/api/convertible-bonds", convertibleBondsHandler);
	app.get("/api/ipo", ipoHandler);
}
