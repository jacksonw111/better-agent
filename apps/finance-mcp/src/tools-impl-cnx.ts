// A股扩展 tool handlers (巨潮公告 + 板块归属 + 新浪 ETF 期权). Merged into
// the HANDLERS record via tools-impl-v6.ts.
import { withCache } from "./core/cache";
import { getAnnouncements } from "./core/cninfo/announcements";
import { getStockBoards } from "./core/eastmoney/stock-boards";
import { getOptionContracts, getOptionQuote } from "./core/sina/options";
import { parseSymbol } from "./core/symbol";
import type { ToolEnv, ToolResult } from "./tools-impl";
import {
	argNumber,
	argOptionalString,
	argString,
	toolJson,
} from "./tools-impl";

const ANNOUNCEMENTS_TTL_SECONDS = 1800;
const BOARDS_TTL_SECONDS = 3600;
const CONTRACTS_TTL_SECONDS = 3600;
const QUOTE_TTL_SECONDS = 60;
const DEFAULT_ANNOUNCEMENTS_LIMIT = 20;
const DEFAULT_UNDERLYING = "510050";

async function handleAnnouncements(
	args: Record<string, unknown>
): Promise<ToolResult> {
	const { code } = parseSymbol(argString(args, "symbol"));
	const limit = argNumber(args, "limit", DEFAULT_ANNOUNCEMENTS_LIMIT);
	const search = argOptionalString(args, "search") ?? "";
	return toolJson(
		await withCache(
			`announcements:${code}:${limit}:${search}`,
			ANNOUNCEMENTS_TTL_SECONDS,
			() => getAnnouncements(code, limit, search)
		)
	);
}

async function handleStockBoards(
	args: Record<string, unknown>
): Promise<ToolResult> {
	const { code } = parseSymbol(argString(args, "symbol"));
	return toolJson(
		await withCache(`stock-boards:${code}`, BOARDS_TTL_SECONDS, () =>
			getStockBoards(code)
		)
	);
}

async function handleOptionContracts(
	args: Record<string, unknown>
): Promise<ToolResult> {
	const underlying =
		argOptionalString(args, "underlying") ?? DEFAULT_UNDERLYING;
	const kind = argOptionalString(args, "kind") === "put" ? "put" : "call";
	return toolJson(
		await withCache(
			`option-contracts:${underlying}:${kind}`,
			CONTRACTS_TTL_SECONDS,
			() => getOptionContracts(underlying, kind)
		)
	);
}

async function handleOptionQuote(
	args: Record<string, unknown>
): Promise<ToolResult> {
	const code = argString(args, "code");
	return toolJson(
		await withCache(`option-quote:${code}`, QUOTE_TTL_SECONDS, () =>
			getOptionQuote(code)
		)
	);
}

export const CNX_HANDLERS: Record<
	string,
	(args: Record<string, unknown>, env: ToolEnv) => Promise<ToolResult>
> = {
	finance_announcements: (args) => handleAnnouncements(args),
	finance_stock_boards: (args) => handleStockBoards(args),
	finance_option_contracts: (args) => handleOptionContracts(args),
	finance_option_quote: (args) => handleOptionQuote(args),
};
