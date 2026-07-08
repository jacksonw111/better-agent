// B57's fund-flow / sector-board handlers, split out of tools-impl.ts (which
// is at the project's 300-line-per-file cap) — same pattern as
// tool-defs-market.ts splitting out of tool-defs.ts.
import { withCache } from "./core/cache";
import { getHsgtFlow } from "./core/eastmoney/hsgt";
import { getMoneyFlow } from "./core/eastmoney/money-flow";
import { getMarketNews, getStockNews } from "./core/eastmoney/news";
import { getSectorConstituents, getSectorList } from "./core/eastmoney/sector";
import type { ToolResult } from "./tools-impl";
import { argNumber, argString, toolJson } from "./tools-impl";

const DEFAULT_MONEY_FLOW_DAYS = 5;
const DEFAULT_HSGT_DAYS = 10;
const DEFAULT_NEWS_LIMIT = 20;
const DEFAULT_STOCK_NEWS_LIMIT = 10;

export async function handleMoneyFlow(
	args: Record<string, unknown>
): Promise<ToolResult> {
	const symbol = argString(args, "symbol");
	const days = argNumber(args, "days", DEFAULT_MONEY_FLOW_DAYS);
	return toolJson(
		await withCache(`flow:${symbol}:${days}`, 120, () =>
			getMoneyFlow(symbol, days)
		)
	);
}

export async function handleHsgtFlow(
	args: Record<string, unknown>
): Promise<ToolResult> {
	const days = argNumber(args, "days", DEFAULT_HSGT_DAYS);
	return toolJson(
		await withCache(`hsgt:${days}`, 300, () => getHsgtFlow(days))
	);
}

export async function handleSectorList(
	args: Record<string, unknown>
): Promise<ToolResult> {
	const type = argString(args, "type") || "industry";
	return toolJson(
		await withCache(`sectors:${type}`, 120, () => getSectorList(type))
	);
}

export async function handleSectorConstituents(
	args: Record<string, unknown>
): Promise<ToolResult> {
	const board = argString(args, "board");
	return toolJson(
		await withCache(`sectorstocks:${board}`, 120, () =>
			getSectorConstituents(board)
		)
	);
}

// B11's market/per-stock news handlers.
export async function handleNews(
	args: Record<string, unknown>
): Promise<ToolResult> {
	const limit = argNumber(args, "limit", DEFAULT_NEWS_LIMIT);
	return toolJson(
		await withCache(`news:${limit}`, 60, () => getMarketNews(limit))
	);
}

export async function handleStockNews(
	args: Record<string, unknown>
): Promise<ToolResult> {
	const query = argString(args, "query");
	const limit = argNumber(args, "limit", DEFAULT_STOCK_NEWS_LIMIT);
	return toolJson(
		await withCache(`stocknews:${query}:${limit}`, 300, () =>
			getStockNews(query, limit)
		)
	);
}
