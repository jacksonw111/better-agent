import { withCache } from "./core/cache";
import { centralBank } from "./core/eastmoney/central-bank";
import { earningsCalendar } from "./core/eastmoney/earnings";
import { listReports } from "./core/eastmoney/periodic-reports";
import { economicCalendar } from "./core/fred/economic";
import { getKline, type KlinePeriod } from "./core/tencent/kline";
import { getQuote } from "./core/tencent/quote";
import type { Market } from "./core/types";

export interface ToolEnv {
	FRED_API_KEY?: string;
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

function argBoolean(args: Record<string, unknown>, key: string): boolean {
	return args[key] === true;
}

function argOptionalString(
	args: Record<string, unknown>,
	key: string
): string | undefined {
	const value = args[key];
	return typeof value === "string" && value.length > 0 ? value : undefined;
}

function argKlinePeriod(args: Record<string, unknown>): KlinePeriod {
	if (args.period === "week" || args.period === "month") {
		return args.period;
	}
	return "day";
}

async function handleQuote(args: Record<string, unknown>): Promise<ToolResult> {
	const symbol = argString(args, "symbol");
	return toolJson(
		await withCache(`quote:${symbol}`, 5, () => getQuote(symbol))
	);
}

async function handleKline(args: Record<string, unknown>): Promise<ToolResult> {
	const symbol = argString(args, "symbol");
	const period = argKlinePeriod(args);
	const limit = argNumber(args, "limit", DEFAULT_KLINE_LIMIT);
	return toolJson(
		await withCache(`kline:${symbol}:${period}:${limit}`, 300, () =>
			getKline(symbol, period, limit)
		)
	);
}

async function handleListReports(
	args: Record<string, unknown>
): Promise<ToolResult> {
	const symbol = argString(args, "symbol");
	const years = argNumber(args, "years", DEFAULT_REPORT_YEARS);
	return toolJson(
		await withCache(`reports:${symbol}:${years}`, 3600, () =>
			listReports(symbol, years)
		)
	);
}

function argMarket(args: Record<string, unknown>): Market {
	return args.market === "us" || args.market === "hk" ? args.market : "a";
}

async function handleEarningsCalendar(
	args: Record<string, unknown>
): Promise<ToolResult> {
	const market = argMarket(args);
	const date = argString(args, "date");
	return toolJson(
		await withCache(`earn:${market}:${date}`, 1800, () =>
			earningsCalendar(market, date)
		)
	);
}

async function handleEconomicCalendar(
	args: Record<string, unknown>,
	env: ToolEnv
): Promise<ToolResult> {
	const from = argString(args, "from");
	const to = argString(args, "to");
	const country = typeof args.country === "string" ? args.country : undefined;
	const all = argBoolean(args, "all");
	const event = argOptionalString(args, "event");
	const cacheKey = `econ:${from}:${to}:${country ?? "all"}:${all ? "all" : "key"}:${event ?? ""}`;
	return toolJson(
		await withCache(cacheKey, 1800, () =>
			economicCalendar(from, to, env.FRED_API_KEY ?? "", country, {
				all,
				event,
			})
		)
	);
}

async function handleCentralBank(
	args: Record<string, unknown>
): Promise<ToolResult> {
	const market = args.market === "us" ? "us" : "a"; // "cn" maps to the non-us branch
	return toolJson(
		await withCache(`cb:${market}`, 1800, () =>
			centralBank(market as "us" | "a")
		)
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
	if (name === "finance_central_bank") {
		return await handleCentralBank(_args);
	}
	return toolText(`Unknown tool: ${name}`, true);
}
