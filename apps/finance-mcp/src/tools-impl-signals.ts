// V4/V5 batch: margin + price↔sentiment divergence + sentiment-compare +
// 股东户数 + A股人气榜 tool handlers, split into a new file since tools-impl.ts
// is at the project's 300-line-per-file cap — same pattern as
// tools-impl-extra.ts. SIGNALS_HANDLERS is spread into the HANDLERS record in
// tools-impl.ts.
import { sentimentCompare } from "./core/adanos/compare";
import { withCache } from "./core/cache";
import { getCnHot } from "./core/eastmoney/cn-hot";
import { getHolderCount } from "./core/eastmoney/holder-count";
import { getMargin } from "./core/eastmoney/margin";
import { getDivergence } from "./core/signals/divergence";
import type { ToolEnv, ToolResult } from "./tools-impl";
import {
	argNumber,
	argOptionalString,
	argString,
	toolJson,
} from "./tools-impl";

const DEFAULT_MARGIN_LIMIT = 10;
const DEFAULT_DIVERGENCE_SOURCE = "x";
const DEFAULT_CN_HOT_LIMIT = 20;

function parseTickers(raw: string): string[] {
	return raw
		.split(",")
		.map((t) => t.trim())
		.filter((t) => t.length > 0);
}

async function handleMargin(
	args: Record<string, unknown>
): Promise<ToolResult> {
	const symbol = argString(args, "symbol");
	const limit = argNumber(args, "limit", DEFAULT_MARGIN_LIMIT);
	return toolJson(
		await withCache(`margin:${symbol}:${limit}`, 1800, () =>
			getMargin(symbol, limit)
		)
	);
}

async function handleDivergence(
	args: Record<string, unknown>,
	env: ToolEnv
): Promise<ToolResult> {
	const ticker = argString(args, "ticker");
	const source = argOptionalString(args, "source") ?? DEFAULT_DIVERGENCE_SOURCE;
	return toolJson(
		await withCache(`div-signal:${ticker}:${source}`, 600, () =>
			getDivergence(ticker, source, env.ADANOS_API_KEY ?? "")
		)
	);
}

async function handleSentimentCompare(
	args: Record<string, unknown>,
	env: ToolEnv
): Promise<ToolResult> {
	const tickersRaw = argString(args, "tickers");
	const tickers = parseTickers(tickersRaw);
	const source = argOptionalString(args, "source");
	const asset = argOptionalString(args, "asset");
	const cacheKey = `sent-cmp:${tickersRaw}:${source ?? ""}:${asset ?? ""}`;
	return toolJson(
		await withCache(cacheKey, 300, () =>
			sentimentCompare(tickers, source, asset, env.ADANOS_API_KEY ?? "")
		)
	);
}

async function handleHolderCount(
	args: Record<string, unknown>
): Promise<ToolResult> {
	const symbol = argString(args, "symbol");
	return toolJson(
		await withCache(`holdercount:${symbol}`, 3600, () => getHolderCount(symbol))
	);
}

async function handleCnHot(args: Record<string, unknown>): Promise<ToolResult> {
	const limit = argNumber(args, "limit", DEFAULT_CN_HOT_LIMIT);
	return toolJson(
		await withCache(`cnhot:${limit}`, 300, () => getCnHot(limit))
	);
}

export const SIGNALS_HANDLERS: Record<
	string,
	(args: Record<string, unknown>, env: ToolEnv) => Promise<ToolResult>
> = {
	finance_margin: (args) => handleMargin(args),
	finance_divergence: (args, env) => handleDivergence(args, env),
	finance_sentiment_compare: (args, env) => handleSentimentCompare(args, env),
	finance_holder_count: (args) => handleHolderCount(args),
	finance_cn_hot: (args) => handleCnHot(args),
};
