// 美股/港股增强 + 行业新闻 tool handlers (Yahoo options/analyst/holders +
// SEC EDGAR + curated industry RSS). Merged into the HANDLERS record via
// tools-impl-v6.ts.
import { withCache } from "./core/cache";
import { getKalshiMarkets } from "./core/kalshi/markets";
import { getPredictionHistory } from "./core/polymarket/history";
import { getIndustryNews } from "./core/rss/industry-news";
import { getSecFilings } from "./core/sec/edgar";
import { getXbrlFacts } from "./core/sec/xbrl";
import { getAnalystRatings } from "./core/yahoo/analyst";
import { getInstitutionalHolders } from "./core/yahoo/holders";
import { getUsOptions } from "./core/yahoo/options";
import type { ToolEnv, ToolResult } from "./tools-impl";
import {
	argNumber,
	argOptionalString,
	argString,
	toolJson,
} from "./tools-impl";

const US_OPTIONS_TTL_SECONDS = 300;
const ANALYST_TTL_SECONDS = 3600;
const HOLDERS_TTL_SECONDS = 3600;
const SEC_TTL_SECONDS = 3600;
const NEWS_TTL_SECONDS = 900;
const KALSHI_TTL_SECONDS = 300;
const PREDICTION_TTL_SECONDS = 600;
const DEFAULT_FILINGS_LIMIT = 20;
const DEFAULT_NEWS_LIMIT = 20;
const NO_EXPIRATION = 0;

function parseMetrics(raw: string): string[] {
	return raw
		.split(",")
		.map((m) => m.trim())
		.filter((m) => m.length > 0);
}

async function handleUsOptions(
	args: Record<string, unknown>
): Promise<ToolResult> {
	const ticker = argString(args, "ticker").toUpperCase();
	const expiration = argNumber(args, "expiration", NO_EXPIRATION);
	return toolJson(
		await withCache(
			`us-options:${ticker}:${expiration}`,
			US_OPTIONS_TTL_SECONDS,
			() => getUsOptions(ticker, expiration || undefined)
		)
	);
}

async function handleAnalystRatings(
	args: Record<string, unknown>
): Promise<ToolResult> {
	const ticker = argString(args, "ticker").toUpperCase();
	return toolJson(
		await withCache(`analyst:${ticker}`, ANALYST_TTL_SECONDS, () =>
			getAnalystRatings(ticker)
		)
	);
}

async function handleInstitutionalHolders(
	args: Record<string, unknown>
): Promise<ToolResult> {
	const ticker = argString(args, "ticker").toUpperCase();
	return toolJson(
		await withCache(`inst-holders:${ticker}`, HOLDERS_TTL_SECONDS, () =>
			getInstitutionalHolders(ticker)
		)
	);
}

async function handleSecFilings(
	args: Record<string, unknown>
): Promise<ToolResult> {
	const ticker = argString(args, "ticker").toUpperCase();
	const formType = argOptionalString(args, "form_type") ?? "";
	const limit = argNumber(args, "limit", DEFAULT_FILINGS_LIMIT);
	return toolJson(
		await withCache(
			`sec-filings:${ticker}:${formType}:${limit}`,
			SEC_TTL_SECONDS,
			() => getSecFilings(ticker, formType, limit)
		)
	);
}

async function handleSecFacts(
	args: Record<string, unknown>
): Promise<ToolResult> {
	const ticker = argString(args, "ticker").toUpperCase();
	const metricsRaw = argOptionalString(args, "metrics") ?? "";
	return toolJson(
		await withCache(`sec-facts:${ticker}:${metricsRaw}`, SEC_TTL_SECONDS, () =>
			getXbrlFacts(ticker, parseMetrics(metricsRaw))
		)
	);
}

async function handleKalshi(
	args: Record<string, unknown>
): Promise<ToolResult> {
	const series = argOptionalString(args, "series") ?? "";
	const query = argOptionalString(args, "query") ?? "";
	const limit = argNumber(args, "limit", DEFAULT_NEWS_LIMIT);
	return toolJson(
		await withCache(
			`kalshi:${series}:${query}:${limit}`,
			KALSHI_TTL_SECONDS,
			() => getKalshiMarkets(series, query, limit)
		)
	);
}

async function handlePredictionHistory(
	args: Record<string, unknown>
): Promise<ToolResult> {
	const query = argString(args, "query");
	const interval = argOptionalString(args, "interval") ?? "1w";
	return toolJson(
		await withCache(
			`pred-history:${query}:${interval}`,
			PREDICTION_TTL_SECONDS,
			() => getPredictionHistory(query, interval)
		)
	);
}

async function handleIndustryNews(
	args: Record<string, unknown>
): Promise<ToolResult> {
	const sector = argString(args, "sector");
	const limit = argNumber(args, "limit", DEFAULT_NEWS_LIMIT);
	return toolJson(
		await withCache(`industry-news:${sector}:${limit}`, NEWS_TTL_SECONDS, () =>
			getIndustryNews(sector, limit)
		)
	);
}

export const GLOBAL_HANDLERS: Record<
	string,
	(args: Record<string, unknown>, env: ToolEnv) => Promise<ToolResult>
> = {
	finance_us_options: (args) => handleUsOptions(args),
	finance_analyst_ratings: (args) => handleAnalystRatings(args),
	finance_institutional_holders: (args) => handleInstitutionalHolders(args),
	finance_sec_filings: (args) => handleSecFilings(args),
	finance_sec_facts: (args) => handleSecFacts(args),
	finance_kalshi: (args) => handleKalshi(args),
	finance_prediction_history: (args) => handlePredictionHistory(args),
	finance_industry_news: (args) => handleIndustryNews(args),
};
