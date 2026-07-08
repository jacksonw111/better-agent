// codex status parsing — token usage + thread status from `codex app-server`
// notifications, mapped into the normalized StatusSnapshot fields. Kept beside
// normalize/codex.ts (mirrors pi-status.ts) so codex.ts stays under the
// 300-line file cap; consumed by the codex adapter's getStatus.

import type {
	StatusSnapshotContextUsage,
	StatusSnapshotTokens,
} from "../adapters/types";
import { asString, isRecord } from "./types";

export const CODEX_TOKEN_USAGE_METHOD = "thread/tokenUsage/updated";
export const CODEX_THREAD_STATUS_METHOD = "thread/status/changed";

/** What `parseCodexTokenUsage` extracts — field names already match
 * `StatusSnapshotDetail` (see ../adapters/types.ts). */
export interface CodexTokenUsage {
	contextUsage?: StatusSnapshotContextUsage;
	tokens?: StatusSnapshotTokens;
}

function asNumber(value: unknown): number | undefined {
	return typeof value === "number" ? value : undefined;
}

const PERCENT_MULTIPLIER = 100;

/** used/size → whole-number percent, only when both figures exist. */
function contextUsageFrom(
	used: number | undefined,
	size: number | undefined
): StatusSnapshotContextUsage | undefined {
	if (used === undefined || size === undefined || size <= 0) {
		// biome-ignore lint/complexity/noUselessUndefined: explicit so every path returns a value (eslint consistent-return)
		return undefined;
	}
	return { used, size, pct: Math.round((used / size) * PERCENT_MULTIPLIER) };
}

/**
 * Parses a `thread/tokenUsage/updated` notification's params into the
 * snapshot's tokens/context fields, or `null` when the params don't carry a
 * usable `tokenUsage` object.
 *
 * ASSUMPTION (unverified — no `codex` binary; shape inferred from codex
 * core's `TokenUsageInfo` as camelCased by the app-server): `params.tokenUsage`
 * is `{totalTokenUsage: {inputTokens, cachedInputTokens, outputTokens,
 * totalTokens}, lastTokenUsage: {...}, modelContextWindow}`; a flat
 * `{inputTokens, ...}` object (no `totalTokenUsage` nesting) is accepted too.
 * Reverify against the installed codex version before relying on this.
 */
export function parseCodexTokenUsage(params: unknown): CodexTokenUsage | null {
	if (!(isRecord(params) && isRecord(params.tokenUsage))) {
		return null;
	}
	const usage = params.tokenUsage;
	const totals = isRecord(usage.totalTokenUsage)
		? usage.totalTokenUsage
		: usage;
	return {
		tokens: {
			input: asNumber(totals.inputTokens),
			output: asNumber(totals.outputTokens),
			cacheRead: asNumber(totals.cachedInputTokens),
		},
		contextUsage: contextUsageFrom(
			asNumber(totals.totalTokens),
			asNumber(usage.modelContextWindow)
		),
	};
}

/**
 * Parses a `thread/status/changed` notification's params into the snapshot's
 * `running` flag, or `undefined` when no status can be read.
 *
 * ASSUMPTION (unverified — same source as `parseCodexTokenUsage`): `params.
 * status` is either a plain string or a `{type: string}` tagged enum; any
 * value other than "idle" (e.g. "active"/"running") means a turn is
 * in flight.
 */
export function parseCodexThreadStatus(params: unknown): boolean | undefined {
	if (!isRecord(params)) {
		// biome-ignore lint/complexity/noUselessUndefined: explicit so every path returns a value (eslint consistent-return)
		return undefined;
	}
	const status = isRecord(params.status)
		? asString(params.status.type)
		: asString(params.status);
	if (status === undefined) {
		// biome-ignore lint/complexity/noUselessUndefined: explicit so every path returns a value (eslint consistent-return)
		return undefined;
	}
	return status !== "idle";
}
