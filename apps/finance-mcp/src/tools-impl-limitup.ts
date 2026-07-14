// 打板层 tool handlers (东财四池 + 同花顺涨停揭秘 + 情绪速算). Merged into
// the HANDLERS record via tools-impl-v6.ts, same pattern as
// tools-impl-signals.ts.
import { withCache } from "./core/cache";
import {
	getLimitUpPool,
	getLimitUpSentiment,
	type LimitUpPoolKind,
} from "./core/eastmoney/limit-up";
import { getLimitUpReasons } from "./core/ths/limit-up-reasons";
import type { ToolEnv, ToolResult } from "./tools-impl";
import { argOptionalString, argString, toolJson } from "./tools-impl";

const POOL_TTL_SECONDS = 120;
const REASONS_TTL_SECONDS = 300;
const POOL_KINDS: readonly LimitUpPoolKind[] = ["zt", "zb", "dt", "yzt"];
const DEFAULT_POOL: LimitUpPoolKind = "zt";

function coercePool(raw: string | undefined): LimitUpPoolKind {
	return POOL_KINDS.find((kind) => kind === raw) ?? DEFAULT_POOL;
}

async function handleLimitUpPool(
	args: Record<string, unknown>
): Promise<ToolResult> {
	const pool = coercePool(argOptionalString(args, "pool"));
	const date = argString(args, "date");
	return toolJson(
		await withCache(`limitup:${pool}:${date}`, POOL_TTL_SECONDS, () =>
			getLimitUpPool(pool, date)
		)
	);
}

async function handleLimitUpReasons(
	args: Record<string, unknown>
): Promise<ToolResult> {
	const date = argString(args, "date");
	return toolJson(
		await withCache(`limitup-reasons:${date}`, REASONS_TTL_SECONDS, () =>
			getLimitUpReasons(date)
		)
	);
}

async function handleLimitUpSentiment(
	args: Record<string, unknown>
): Promise<ToolResult> {
	const date = argString(args, "date");
	return toolJson(
		await withCache(`limitup-sentiment:${date}`, POOL_TTL_SECONDS, () =>
			getLimitUpSentiment(date)
		)
	);
}

export const LIMITUP_HANDLERS: Record<
	string,
	(args: Record<string, unknown>, env: ToolEnv) => Promise<ToolResult>
> = {
	finance_limit_up_pool: (args) => handleLimitUpPool(args),
	finance_limit_up_reasons: (args) => handleLimitUpReasons(args),
	finance_limit_up_sentiment: (args) => handleLimitUpSentiment(args),
};
