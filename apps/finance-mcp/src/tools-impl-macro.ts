// B9's FRED-backed handlers (economic calendar + macro-indicator values + US
// yield curve) plus CN macro-indicator values, split out of tools-impl.ts
// (which is at the project's 300-line-per-file cap) — same pattern as
// tools-impl-market.ts splitting out of tools-impl.ts.

import { withCache } from "./core/cache";
import { getMacroCn } from "./core/eastmoney/macro";
import { economicCalendar } from "./core/fred/economic";
import { getMacroUs } from "./core/fred/macro";
import { getYieldCurve } from "./core/fred/yield-curve";
import {
	argNumber,
	argOptionalString,
	argString,
	type ToolEnv,
	type ToolResult,
	toolJson,
} from "./tools-impl";

const DEFAULT_MACRO_LIMIT = 12;

function argBoolean(args: Record<string, unknown>, key: string): boolean {
	return args[key] === true;
}

export async function handleEconomicCalendar(
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

export async function handleMacroUs(
	args: Record<string, unknown>,
	env: ToolEnv
): Promise<ToolResult> {
	const indicator = argOptionalString(args, "indicator");
	const limit = argNumber(args, "limit", DEFAULT_MACRO_LIMIT);
	const cacheKey = `macrous:${indicator ?? "dash"}:${limit}`;
	return toolJson(
		await withCache(cacheKey, 3600, () =>
			getMacroUs(indicator, limit, env.FRED_API_KEY ?? "")
		)
	);
}

export async function handleMacroCn(
	args: Record<string, unknown>
): Promise<ToolResult> {
	const indicator = argOptionalString(args, "indicator");
	const cacheKey = `macrocn:${indicator ?? "dash"}`;
	return toolJson(await withCache(cacheKey, 3600, () => getMacroCn(indicator)));
}

export async function handleYieldCurve(env: ToolEnv): Promise<ToolResult> {
	return toolJson(
		await withCache("yieldcurve", 3600, () =>
			getYieldCurve(env.FRED_API_KEY ?? "")
		)
	);
}
