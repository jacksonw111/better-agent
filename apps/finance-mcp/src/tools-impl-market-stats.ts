// Market-stats tool handlers (交易日历 + 全市场宽度). Merged into the HANDLERS
// record via tools-impl-v6.ts, same pattern as tools-impl-limitup.ts.

import { withCache } from "./core/cache";
import { getSharePledge } from "./core/eastmoney/pledge";
import { getIndexValuation } from "./core/legulegu/index-valuation";
import { getMarketBreadth } from "./core/market/breadth";
import { getTradeCalendar } from "./core/market/trade-calendar";
import { getUsInsider } from "./core/openinsider/insider";
import { getHistoricalVolatility } from "./core/technical/volatility";
import type { ToolEnv, ToolResult } from "./tools-impl";
import {
	argNumber,
	argOptionalString,
	argString,
	toolJson,
} from "./tools-impl";

const CALENDAR_TTL_SECONDS = 300;
const BREADTH_TTL_SECONDS = 120;
const PLEDGE_TTL_SECONDS = 3600;
const DEFAULT_PLEDGE_LIMIT = 12;
const VALUATION_TTL_SECONDS = 3600;
const VOLATILITY_TTL_SECONDS = 600;
const INSIDER_TTL_SECONDS = 3600;
const DEFAULT_INSIDER_LIMIT = 25;
const DEFAULT_INSIDER_DAYS = 365;

function resolveCalendar() {
	return withCache("trade-calendar", CALENDAR_TTL_SECONDS, () =>
		getTradeCalendar()
	);
}

async function handleTradeCalendar(): Promise<ToolResult> {
	const cal = await resolveCalendar();
	return toolJson(
		cal ?? { lastTradeDate: "", isTodayTradingDay: false, tradeDays: [] }
	);
}

async function handleMarketBreadth(
	args: Record<string, unknown>
): Promise<ToolResult> {
	let date = argOptionalString(args, "date");
	if (!date) {
		const cal = await resolveCalendar();
		date = cal ? cal.lastTradeDate.replaceAll("-", "") : "";
	}
	return toolJson(
		await withCache(`market-breadth:${date}`, BREADTH_TTL_SECONDS, () =>
			getMarketBreadth(date)
		)
	);
}

async function handleSharePledge(
	args: Record<string, unknown>
): Promise<ToolResult> {
	const symbol = argString(args, "symbol");
	const limit = argNumber(args, "limit", DEFAULT_PLEDGE_LIMIT);
	return toolJson(
		await withCache(`share-pledge:${symbol}:${limit}`, PLEDGE_TTL_SECONDS, () =>
			getSharePledge(symbol, limit)
		)
	);
}

async function handleIndexValuation(
	args: Record<string, unknown>
): Promise<ToolResult> {
	const symbol = argString(args, "symbol");
	return toolJson(
		await withCache(`index-valuation:${symbol}`, VALUATION_TTL_SECONDS, () =>
			getIndexValuation(symbol)
		)
	);
}

async function handleVolatility(
	args: Record<string, unknown>
): Promise<ToolResult> {
	const symbol = argString(args, "symbol");
	return toolJson(
		await withCache(`volatility:${symbol}`, VOLATILITY_TTL_SECONDS, () =>
			getHistoricalVolatility(symbol)
		)
	);
}

async function handleUsInsider(
	args: Record<string, unknown>
): Promise<ToolResult> {
	const symbol = argString(args, "symbol");
	const limit = argNumber(args, "limit", DEFAULT_INSIDER_LIMIT);
	const days = argNumber(args, "days", DEFAULT_INSIDER_DAYS);
	return toolJson(
		await withCache(
			`us-insider:${symbol}:${limit}:${days}`,
			INSIDER_TTL_SECONDS,
			() => getUsInsider(symbol, limit, days)
		)
	);
}

export const MARKET_STATS_HANDLERS: Record<
	string,
	(args: Record<string, unknown>, env: ToolEnv) => Promise<ToolResult>
> = {
	finance_trade_calendar: () => handleTradeCalendar(),
	finance_market_breadth: (args) => handleMarketBreadth(args),
	finance_share_pledge: (args) => handleSharePledge(args),
	finance_index_valuation: (args) => handleIndexValuation(args),
	finance_volatility: (args) => handleVolatility(args),
	finance_us_insider: (args) => handleUsInsider(args),
};
