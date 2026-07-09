// V7 batch: market-events tool handlers (大宗交易/高管增减持/停复牌), split out
// of tools-impl.ts (which is at the project's 300-line-per-file cap) — same
// pattern as tools-impl-data.ts / tools-impl-signals.ts. EVENTS_HANDLERS is
// spread into the HANDLERS record in tools-impl.ts.
import { withCache } from "./core/cache";
import { getBlockTrades } from "./core/eastmoney/block-trades";
import { getInsiderTrades } from "./core/eastmoney/insider";
import { getSuspension } from "./core/eastmoney/suspension";
import type { ToolResult } from "./tools-impl";
import { argNumber, argOptionalString, toolJson } from "./tools-impl";

const DEFAULT_BLOCK_TRADE_LIMIT = 20;
const DEFAULT_INSIDER_LIMIT = 20;
const DEFAULT_SUSPENSION_LIMIT = 30;

async function handleBlockTrades(
	args: Record<string, unknown>
): Promise<ToolResult> {
	const symbol = argOptionalString(args, "symbol");
	const limit = argNumber(args, "limit", DEFAULT_BLOCK_TRADE_LIMIT);
	return toolJson(
		await withCache(`block:${symbol ?? "all"}:${limit}`, 1800, () =>
			getBlockTrades(symbol, limit)
		)
	);
}

async function handleInsiderTrades(
	args: Record<string, unknown>
): Promise<ToolResult> {
	const symbol = argOptionalString(args, "symbol");
	const limit = argNumber(args, "limit", DEFAULT_INSIDER_LIMIT);
	return toolJson(
		await withCache(`insider:${symbol ?? "all"}:${limit}`, 1800, () =>
			getInsiderTrades(symbol, limit)
		)
	);
}

async function handleSuspension(
	args: Record<string, unknown>
): Promise<ToolResult> {
	const limit = argNumber(args, "limit", DEFAULT_SUSPENSION_LIMIT);
	return toolJson(
		await withCache(`suspend:${limit}`, 1800, () => getSuspension(limit))
	);
}

export const EVENTS_HANDLERS: Record<
	string,
	(args: Record<string, unknown>) => Promise<ToolResult>
> = {
	finance_block_trades: (args) => handleBlockTrades(args),
	finance_insider_trades: (args) => handleInsiderTrades(args),
	finance_suspension: (args) => handleSuspension(args),
};
