// Adanos market-sentiment handlers (trending, ticker, market), split out of
// tools-impl.ts (which is at the project's 300-line-per-file cap) — same
// pattern as tools-impl-macro.ts.
import {
	sentimentMarket,
	sentimentTicker,
	sentimentTrending,
} from "./core/adanos/sentiment";
import { withCache } from "./core/cache";
import {
	argNumber,
	argOptionalString,
	argString,
	type ToolEnv,
	type ToolResult,
	toolJson,
} from "./tools-impl";

const DEFAULT_TRENDING_LIMIT = 10;

function adanosKey(env: ToolEnv): string {
	return env.ADANOS_API_KEY ?? "";
}

export async function handleSentimentTrending(
	args: Record<string, unknown>,
	env: ToolEnv
): Promise<ToolResult> {
	const source = argOptionalString(args, "source");
	const asset = argOptionalString(args, "asset");
	const limit = argNumber(args, "limit", DEFAULT_TRENDING_LIMIT);
	const cacheKey = `sent-trend:${source ?? ""}:${asset ?? ""}:${limit}`;
	return toolJson(
		await withCache(cacheKey, 300, () =>
			sentimentTrending(source, asset, limit, adanosKey(env))
		)
	);
}

export async function handleSentimentTicker(
	args: Record<string, unknown>,
	env: ToolEnv
): Promise<ToolResult> {
	const ticker = argString(args, "ticker");
	const source = argOptionalString(args, "source");
	const asset = argOptionalString(args, "asset");
	const cacheKey = `sent-ticker:${ticker}:${source ?? ""}:${asset ?? ""}`;
	return toolJson(
		await withCache(cacheKey, 300, () =>
			sentimentTicker(ticker, source, asset, adanosKey(env))
		)
	);
}

export async function handleSentimentMarket(
	args: Record<string, unknown>,
	env: ToolEnv
): Promise<ToolResult> {
	const source = argOptionalString(args, "source");
	const asset = argOptionalString(args, "asset");
	const cacheKey = `sent-market:${source ?? ""}:${asset ?? ""}`;
	return toolJson(
		await withCache(cacheKey, 300, () =>
			sentimentMarket(source, asset, adanosKey(env))
		)
	);
}
