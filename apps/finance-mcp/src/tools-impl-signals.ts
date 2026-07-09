// V4 batch: margin + price↔sentiment divergence tool handlers, split into a
// new file since tools-impl.ts is at the project's 300-line-per-file cap —
// same pattern as tools-impl-extra.ts. SIGNALS_HANDLERS is spread into the
// HANDLERS record in tools-impl.ts.
import { withCache } from "./core/cache";
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

export const SIGNALS_HANDLERS: Record<
	string,
	(args: Record<string, unknown>, env: ToolEnv) => Promise<ToolResult>
> = {
	finance_margin: (args) => handleMargin(args),
	finance_divergence: (args, env) => handleDivergence(args, env),
};
