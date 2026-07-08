// opencode (ACP): parses the `usage_update` `session/update` notification's
// `update` payload into the status-snapshot's context/cost fields — the ACP
// counterpart to opencode-serve-status.ts's on-demand HTTP parse. Kept beside
// normalize/opencode.ts (mirrors codex-status.ts/pi-status.ts) so neither file
// exceeds the repo's 300-line cap; consumed by the opencode adapter's
// getStatus (adapters/opencode-status.ts).
//
// ASSUMPTION (unverified — no `opencode` binary in this sandbox; shape
// already relied on by the web's `UsageUpdateDetail`, see
// apps/web/src/components/bridge/bridge-session-status.ts, which this mirrors
// field-for-field): a `usage_update` session/update's `update` object is
// `{ sessionUpdate: "usage_update", used, size?, cost?: { amount, currency } }`
// — `used`/`size` are token counts, `cost.amount` is USD. Reverify against a
// real `opencode acp` before relying on any exact field name.

import type { StatusSnapshotContextUsage } from "../adapters/types";
import { isRecord } from "./types";

export const USAGE_UPDATE_SESSION_UPDATE = "usage_update";

/** What `parseOpencodeUsageUpdate` extracts — field names already match
 * `StatusSnapshotDetail` (see ../adapters/types.ts). */
export interface OpencodeUsageUpdate {
	contextUsage?: StatusSnapshotContextUsage;
	costUsd?: number;
}

function asNumber(value: unknown): number | undefined {
	return typeof value === "number" ? value : undefined;
}

const PERCENT_MULTIPLIER = 100;

/** `used` alone is still worth caching (pi/codex report it that way too);
 * `pct` is only derived once both `used` and a positive `size` are known. */
function contextUsageFrom(
	used: number | undefined,
	size: number | undefined
): StatusSnapshotContextUsage | undefined {
	if (used === undefined) {
		// biome-ignore lint/complexity/noUselessUndefined: explicit so every path returns a value (eslint consistent-return)
		return undefined;
	}
	if (size === undefined || size <= 0) {
		return { used };
	}
	return { used, size, pct: Math.round((used / size) * PERCENT_MULTIPLIER) };
}

/**
 * Parses a `session/update` notification's `update` payload into the
 * snapshot's contextUsage/costUsd fields, or `null` when it isn't a
 * `usage_update` (or doesn't parse as one).
 */
export function parseOpencodeUsageUpdate(
	update: unknown
): OpencodeUsageUpdate | null {
	if (
		!isRecord(update) ||
		update.sessionUpdate !== USAGE_UPDATE_SESSION_UPDATE
	) {
		return null;
	}
	const cost = isRecord(update.cost) ? asNumber(update.cost.amount) : undefined;
	return {
		contextUsage: contextUsageFrom(
			asNumber(update.used),
			asNumber(update.size)
		),
		costUsd: cost,
	};
}
