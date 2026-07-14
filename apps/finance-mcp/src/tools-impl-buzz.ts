// 舆情/热度层 tool handlers (同花顺热榜/强势股归因 + 东财概念命中 + 互动易).
// Merged into the HANDLERS record via tools-impl-v6.ts.
import { withCache } from "./core/cache";
import { getInvestorQa } from "./core/cninfo/irm";
import { getHotConcepts } from "./core/eastmoney/hot-concept";
import { parseSymbol } from "./core/symbol";
import { getThsHotList } from "./core/ths/hot-list";
import { getStrongStocks } from "./core/ths/hot-reason";
import type { ToolEnv, ToolResult } from "./tools-impl";
import {
	argNumber,
	argOptionalString,
	argString,
	toolJson,
} from "./tools-impl";

const HOT_LIST_TTL_SECONDS = 300;
const STRONG_TTL_SECONDS = 600;
const CONCEPTS_TTL_SECONDS = 600;
const QA_TTL_SECONDS = 600;
const DEFAULT_HOT_LIMIT = 20;
const DEFAULT_QA_LIMIT = 20;

function coercePeriod(raw: string | undefined): "hour" | "day" {
	return raw === "day" ? "day" : "hour";
}

async function handleHotList(
	args: Record<string, unknown>
): Promise<ToolResult> {
	const period = coercePeriod(argOptionalString(args, "period"));
	const limit = argNumber(args, "limit", DEFAULT_HOT_LIMIT);
	return toolJson(
		await withCache(`ths-hot:${period}:${limit}`, HOT_LIST_TTL_SECONDS, () =>
			getThsHotList(period, limit)
		)
	);
}

async function handleStrongStocks(
	args: Record<string, unknown>
): Promise<ToolResult> {
	const date = argString(args, "date");
	return toolJson(
		await withCache(`strong-stocks:${date}`, STRONG_TTL_SECONDS, () =>
			getStrongStocks(date)
		)
	);
}

async function handleHotConcepts(
	args: Record<string, unknown>
): Promise<ToolResult> {
	const { code } = parseSymbol(argString(args, "symbol"));
	return toolJson(
		await withCache(`hot-concepts:${code}`, CONCEPTS_TTL_SECONDS, () =>
			getHotConcepts(code)
		)
	);
}

async function handleInvestorQa(
	args: Record<string, unknown>
): Promise<ToolResult> {
	const { code } = parseSymbol(argString(args, "symbol"));
	const limit = argNumber(args, "limit", DEFAULT_QA_LIMIT);
	return toolJson(
		await withCache(`investor-qa:${code}:${limit}`, QA_TTL_SECONDS, () =>
			getInvestorQa(code, limit)
		)
	);
}

export const BUZZ_HANDLERS: Record<
	string,
	(args: Record<string, unknown>, env: ToolEnv) => Promise<ToolResult>
> = {
	finance_hot_list: (args) => handleHotList(args),
	finance_strong_stocks: (args) => handleStrongStocks(args),
	finance_hot_concepts: (args) => handleHotConcepts(args),
	finance_investor_qa: (args) => handleInvestorQa(args),
};
