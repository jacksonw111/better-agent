// V6a batch: event-data tool handlers (业绩预告/限售解禁/可转债/新股IPO),
// split out of tools-impl.ts (which is at the project's 300-line-per-file
// cap) — same pattern as tools-impl-signals.ts. DATA_HANDLERS is spread into
// the HANDLERS record in tools-impl.ts.
import { withCache } from "./core/cache";
import { getConvertibleBonds } from "./core/eastmoney/convertible";
import { getEtfList } from "./core/eastmoney/etf";
import { getIndexWeights } from "./core/eastmoney/index-weights";
import { getIpo } from "./core/eastmoney/ipo";
import { getLockup } from "./core/eastmoney/lockup";
import { getOptionChain } from "./core/eastmoney/options";
import { getPreannounce } from "./core/eastmoney/preannounce";
import type { ToolResult } from "./tools-impl";
import { argNumber, argOptionalString, toolJson } from "./tools-impl";

const DEFAULT_PREANNOUNCE_LIMIT = 20;
const DEFAULT_LOCKUP_LIMIT = 20;
const DEFAULT_CONVERTIBLE_LIMIT = 30;
const DEFAULT_IPO_LIMIT = 20;
const DEFAULT_ETF_LIMIT = 30;

async function handlePreannounce(
	args: Record<string, unknown>
): Promise<ToolResult> {
	const symbol = argOptionalString(args, "symbol");
	const limit = argNumber(args, "limit", DEFAULT_PREANNOUNCE_LIMIT);
	return toolJson(
		await withCache(`preann:${symbol ?? "all"}:${limit}`, 1800, () =>
			getPreannounce(symbol, limit)
		)
	);
}

async function handleLockup(
	args: Record<string, unknown>
): Promise<ToolResult> {
	const symbol = argOptionalString(args, "symbol");
	const limit = argNumber(args, "limit", DEFAULT_LOCKUP_LIMIT);
	return toolJson(
		await withCache(`lockup:${symbol ?? "up"}:${limit}`, 3600, () =>
			getLockup(symbol, limit)
		)
	);
}

async function handleConvertibleBonds(
	args: Record<string, unknown>
): Promise<ToolResult> {
	const limit = argNumber(args, "limit", DEFAULT_CONVERTIBLE_LIMIT);
	return toolJson(
		await withCache(`cbonds:${limit}`, 3600, () => getConvertibleBonds(limit))
	);
}

async function handleIpo(args: Record<string, unknown>): Promise<ToolResult> {
	const limit = argNumber(args, "limit", DEFAULT_IPO_LIMIT);
	return toolJson(await withCache(`ipo:${limit}`, 1800, () => getIpo(limit)));
}

async function handleIndexWeights(
	args: Record<string, unknown>
): Promise<ToolResult> {
	const index = argOptionalString(args, "index");
	return toolJson(
		await withCache(`idxwt:${index ?? "hs300"}`, 86_400, () =>
			getIndexWeights(index)
		)
	);
}

async function handleEtfList(
	args: Record<string, unknown>
): Promise<ToolResult> {
	const limit = argNumber(args, "limit", DEFAULT_ETF_LIMIT);
	return toolJson(
		await withCache(`etf:${limit}`, 300, () => getEtfList(limit))
	);
}

async function handleOptionChain(
	args: Record<string, unknown>
): Promise<ToolResult> {
	const underlying = argOptionalString(args, "underlying");
	return toolJson(
		await withCache(`options:${underlying ?? "300etf"}`, 300, () =>
			getOptionChain(underlying)
		)
	);
}

export const DATA_HANDLERS: Record<
	string,
	(args: Record<string, unknown>) => Promise<ToolResult>
> = {
	finance_earnings_preannounce: (args) => handlePreannounce(args),
	finance_lockup: (args) => handleLockup(args),
	finance_convertible_bonds: (args) => handleConvertibleBonds(args),
	finance_ipo: (args) => handleIpo(args),
	finance_index_weights: (args) => handleIndexWeights(args),
	finance_etf_list: (args) => handleEtfList(args),
	finance_option_chain: (args) => handleOptionChain(args),
};
