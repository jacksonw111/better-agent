// V3 batch: free A-share tool handlers (dividends, dragon-tiger, top
// holders), split out of tools-impl.ts (which is at the project's
// 300-line-per-file cap) — same pattern as tools-impl-market.ts.
import { withCache } from "./core/cache";
import { getDividends } from "./core/eastmoney/dividends";
import { getDragonTiger } from "./core/eastmoney/dragon-tiger";
import { getTopHolders } from "./core/eastmoney/top-holders";
import type { ToolResult } from "./tools-impl";
import {
	argNumber,
	argOptionalString,
	argString,
	toolJson,
} from "./tools-impl";

const DEFAULT_DIVIDENDS_LIMIT = 10;
const DEFAULT_DRAGON_TIGER_LIMIT = 30;

export async function handleDividends(
	args: Record<string, unknown>
): Promise<ToolResult> {
	const symbol = argString(args, "symbol");
	const limit = argNumber(args, "limit", DEFAULT_DIVIDENDS_LIMIT);
	return toolJson(
		await withCache(`div:${symbol}:${limit}`, 3600, () =>
			getDividends(symbol, limit)
		)
	);
}

export async function handleDragonTiger(
	args: Record<string, unknown>
): Promise<ToolResult> {
	const date = argOptionalString(args, "date") ?? "";
	const limit = argNumber(args, "limit", DEFAULT_DRAGON_TIGER_LIMIT);
	return toolJson(
		await withCache(`lhb:${date || "latest"}:${limit}`, 1800, () =>
			getDragonTiger(date, limit)
		)
	);
}

export async function handleTopHolders(
	args: Record<string, unknown>
): Promise<ToolResult> {
	const symbol = argString(args, "symbol");
	return toolJson(
		await withCache(`holders:${symbol}`, 3600, () => getTopHolders(symbol))
	);
}
