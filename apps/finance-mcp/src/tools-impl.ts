import { withCache } from "./core/cache";
import { centralBank } from "./core/eastmoney/central-bank";
import { earningsCalendar } from "./core/eastmoney/earnings";
import { getEarningsForecast } from "./core/eastmoney/forecast";
import { getFinancialIndicators } from "./core/eastmoney/indicators";
import { listReports } from "./core/eastmoney/periodic-reports";
import { getCompanyProfile } from "./core/eastmoney/profile";
import { getStockResearch } from "./core/eastmoney/research";
import { searchAStocks } from "./core/eastmoney/search";
import { getStatements } from "./core/eastmoney/statements";
import { getKeyMetrics } from "./core/eastmoney/valuation";
import { getTechnical } from "./core/technical/indicators";
import { getCommodities } from "./core/tencent/commodity";
import { getIndices } from "./core/tencent/indices";
import { getKline, type KlinePeriod } from "./core/tencent/kline";
import { getQuote } from "./core/tencent/quote";
import type { Market } from "./core/types";
import {
	handleEconomicCalendar,
	handleMacroCn,
	handleMacroUs,
	handleYieldCurve,
} from "./tools-impl-macro";
import {
	handleHsgtFlow,
	handleMoneyFlow,
	handleSectorConstituents,
	handleSectorList,
} from "./tools-impl-market";

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

export function argString(args: Record<string, unknown>, key: string): string {
	const value = args[key];
	return typeof value === "string" ? value : "";
}

export function argNumber(
	args: Record<string, unknown>,
	key: string,
	fallback: number
): number {
	const value = args[key];
	return typeof value === "number" ? value : fallback;
}

export function argOptionalString(
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

const DEFAULT_STATEMENT_PERIODS = 4;
const DEFAULT_INDICATOR_PERIODS = 8;

async function handleKeyMetrics(
	args: Record<string, unknown>
): Promise<ToolResult> {
	const symbol = argString(args, "symbol");
	return toolJson(
		await withCache(`metrics:${symbol}`, 300, () => getKeyMetrics(symbol))
	);
}

async function handleCompanyProfile(
	args: Record<string, unknown>
): Promise<ToolResult> {
	const symbol = argString(args, "symbol");
	return toolJson(
		await withCache(`profile:${symbol}`, 86_400, () =>
			getCompanyProfile(symbol)
		)
	);
}

async function handleFinancialStatements(
	args: Record<string, unknown>
): Promise<ToolResult> {
	const symbol = argString(args, "symbol");
	const statement = argString(args, "statement");
	const periods = argNumber(args, "periods", DEFAULT_STATEMENT_PERIODS);
	return toolJson(
		await withCache(`fin:${symbol}:${statement}:${periods}`, 3600, () =>
			getStatements(symbol, statement, periods)
		)
	);
}

async function handleFinancialIndicators(
	args: Record<string, unknown>
): Promise<ToolResult> {
	const symbol = argString(args, "symbol");
	const periods = argNumber(args, "periods", DEFAULT_INDICATOR_PERIODS);
	return toolJson(
		await withCache(`ind:${symbol}:${periods}`, 3600, () =>
			getFinancialIndicators(symbol, periods)
		)
	);
}

async function handleSearch(
	args: Record<string, unknown>
): Promise<ToolResult> {
	const query = argString(args, "query");
	return toolJson(
		await withCache(`search:${query}`, 3600, () => searchAStocks(query))
	);
}

async function handleResearch(
	args: Record<string, unknown>
): Promise<ToolResult> {
	const symbol = argString(args, "symbol");
	return toolJson(
		await withCache(`research:${symbol}`, 3600, () => getStockResearch(symbol))
	);
}

async function handleEarningsForecast(
	args: Record<string, unknown>
): Promise<ToolResult> {
	const symbol = argString(args, "symbol");
	return toolJson(
		await withCache(`forecast:${symbol}`, 3600, () =>
			getEarningsForecast(symbol)
		)
	);
}

async function handleIndexQuote(
	args: Record<string, unknown>
): Promise<ToolResult> {
	const region = argOptionalString(args, "region") ?? "all";
	return toolJson(
		await withCache(`indices:${region}`, 30, () => getIndices(region))
	);
}

async function handleCommodity(): Promise<ToolResult> {
	return toolJson(await withCache("commodity", 30, () => getCommodities()));
}

async function handleTechnical(
	args: Record<string, unknown>
): Promise<ToolResult> {
	const symbol = argString(args, "symbol");
	const period = argKlinePeriod(args);
	return toolJson(
		await withCache(`tech:${symbol}:${period}`, 60, () =>
			getTechnical(symbol, period)
		)
	);
}

type ToolHandler = (
	args: Record<string, unknown>,
	env: ToolEnv
) => Promise<ToolResult>;

// Feature tasks add one HANDLERS entry per tool (plus its handleX above).
const HANDLERS: Record<string, ToolHandler> = {
	finance_quote: (args) => handleQuote(args),
	finance_kline: (args) => handleKline(args),
	finance_list_reports: (args) => handleListReports(args),
	finance_earnings_calendar: (args) => handleEarningsCalendar(args),
	finance_economic_calendar: (args, env) => handleEconomicCalendar(args, env),
	finance_central_bank: (args) => handleCentralBank(args),
	finance_key_metrics: (args) => handleKeyMetrics(args),
	finance_company_profile: (args) => handleCompanyProfile(args),
	finance_financial_statements: (args) => handleFinancialStatements(args),
	finance_financial_indicators: (args) => handleFinancialIndicators(args),
	finance_search: (args) => handleSearch(args),
	finance_research: (args) => handleResearch(args),
	finance_earnings_forecast: (args) => handleEarningsForecast(args),
	finance_index_quote: (args) => handleIndexQuote(args),
	finance_commodity: () => handleCommodity(),
	finance_technical: (args) => handleTechnical(args),
	finance_money_flow: (args) => handleMoneyFlow(args),
	finance_hsgt_flow: (args) => handleHsgtFlow(args),
	finance_sector_list: (args) => handleSectorList(args),
	finance_sector_constituents: (args) => handleSectorConstituents(args),
	finance_macro_us: (args, env) => handleMacroUs(args, env),
	finance_macro_cn: (args) => handleMacroCn(args),
	finance_yield_curve: (_args, env) => handleYieldCurve(env),
};

export function runTool(
	name: string,
	args: Record<string, unknown>,
	env: ToolEnv = {}
): Promise<ToolResult> {
	const handler = HANDLERS[name];
	if (!handler) {
		return Promise.resolve(toolText(`Unknown tool: ${name}`, true));
	}
	return handler(args, env);
}
