import { earningsCalendar } from "./core/eastmoney/earnings";
import { listReports } from "./core/eastmoney/periodic-reports";
import { economicCalendar } from "./core/finnhub/economic";
import { getKline, type KlinePeriod } from "./core/tencent/kline";
import { getQuote } from "./core/tencent/quote";
import type { Market } from "./core/types";

export interface ToolEnv {
	FINNHUB_API_KEY?: string;
}

export interface ToolResult {
	content: { type: "text"; text: string }[];
	isError: boolean;
}

export function toolText(text: string, isError = false): ToolResult {
	return { content: [{ type: "text", text }], isError };
}

export function toolJson(value: unknown): ToolResult {
	return toolText(JSON.stringify(value));
}

const DEFAULT_KLINE_LIMIT = 240;
const DEFAULT_REPORT_YEARS = 2;

function argString(args: Record<string, unknown>, key: string): string {
	const value = args[key];
	return typeof value === "string" ? value : "";
}

function argNumber(
	args: Record<string, unknown>,
	key: string,
	fallback: number
): number {
	const value = args[key];
	return typeof value === "number" ? value : fallback;
}

function argKlinePeriod(args: Record<string, unknown>): KlinePeriod {
	if (args.period === "week" || args.period === "month") {
		return args.period;
	}
	return "day";
}

async function handleQuote(args: Record<string, unknown>): Promise<ToolResult> {
	return toolJson(await getQuote(argString(args, "symbol")));
}

async function handleKline(args: Record<string, unknown>): Promise<ToolResult> {
	const symbol = argString(args, "symbol");
	const period = argKlinePeriod(args);
	const limit = argNumber(args, "limit", DEFAULT_KLINE_LIMIT);
	return toolJson(await getKline(symbol, period, limit));
}

async function handleListReports(
	args: Record<string, unknown>
): Promise<ToolResult> {
	const symbol = argString(args, "symbol");
	const years = argNumber(args, "years", DEFAULT_REPORT_YEARS);
	return toolJson(await listReports(symbol, years));
}

function argMarket(args: Record<string, unknown>): Market {
	return args.market === "us" || args.market === "hk" ? args.market : "a";
}

async function handleEarningsCalendar(
	args: Record<string, unknown>
): Promise<ToolResult> {
	const market = argMarket(args);
	const date = argString(args, "date");
	return toolJson(await earningsCalendar(market, date));
}

async function handleEconomicCalendar(
	args: Record<string, unknown>,
	env: ToolEnv
): Promise<ToolResult> {
	const from = argString(args, "from");
	const to = argString(args, "to");
	const country = typeof args.country === "string" ? args.country : undefined;
	return toolJson(
		await economicCalendar(from, to, env.FINNHUB_API_KEY ?? "", country)
	);
}

// Feature tasks add `if (name === "finance_x") { ... }` branches above the fallback.
export async function runTool(
	name: string,
	_args: Record<string, unknown>,
	env: ToolEnv = {}
): Promise<ToolResult> {
	if (name === "finance_quote") {
		return await handleQuote(_args);
	}
	if (name === "finance_kline") {
		return await handleKline(_args);
	}
	if (name === "finance_list_reports") {
		return await handleListReports(_args);
	}
	if (name === "finance_earnings_calendar") {
		return await handleEarningsCalendar(_args);
	}
	if (name === "finance_economic_calendar") {
		return await handleEconomicCalendar(_args, env);
	}
	return toolText(`Unknown tool: ${name}`, true);
}
