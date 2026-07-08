// pi's `getStatus` command builders + response parsers — the status-snapshot
// half of what pi-commands.ts does for session_ready, split into its own file
// so neither exceeds the repo's 300-line limit. This module stays stateless
// (like pi-commands.ts): it only parses single `response` lines; the adapter
// (pi.ts's status tracker) owns pairing the get_session_stats/get_state
// replies into one `status_snapshot` event.

import type {
	StatusSnapshotContextUsage,
	StatusSnapshotTokens,
} from "../adapters/types";
import { isRecord } from "./types";

/** Builds the `get_session_stats` stdin command — fired (together with
 * `get_state`) each time the web asks for a status snapshot. */
export function buildPiGetSessionStatsCommand(): string {
	return JSON.stringify({ type: "get_session_stats" });
}

/** The stats half of pi's status snapshot, parsed out of a
 * `get_session_stats` response. Field names already match
 * `StatusSnapshotDetail` (see ../adapters/types.ts) so the adapter can spread
 * it straight into the event detail. */
export interface PiSessionStats {
	contextUsage?: StatusSnapshotContextUsage;
	costUsd?: number;
	tokens?: StatusSnapshotTokens;
}

/** The `{type:"response", command, success:true}` envelope every pi RPC reply
 * wears — returns the reply's `data` record, or `null` for anything else
 * (another command's reply, a failed one, a non-response stdout line). */
function piResponseData(
	raw: unknown,
	command: string
): Record<string, unknown> | null {
	if (
		!isRecord(raw) ||
		raw.type !== "response" ||
		raw.command !== command ||
		raw.success !== true
	) {
		return null;
	}
	return isRecord(raw.data) ? raw.data : null;
}

function asNumber(value: unknown): number | undefined {
	return typeof value === "number" ? value : undefined;
}

/** pi reports tokens with the exact bucket names the snapshot uses. */
function parsePiTokens(value: unknown): StatusSnapshotTokens | undefined {
	if (!isRecord(value)) {
		// biome-ignore lint/complexity/noUselessUndefined: explicit so every path returns a value (eslint consistent-return)
		return undefined;
	}
	return {
		input: asNumber(value.input),
		output: asNumber(value.output),
		cacheRead: asNumber(value.cacheRead),
		cacheWrite: asNumber(value.cacheWrite),
	};
}

/** pi's `{tokens, contextWindow, percent}` → the snapshot's `{used, size,
 * pct}`. */
function parsePiContextUsage(
	value: unknown
): StatusSnapshotContextUsage | undefined {
	if (!isRecord(value)) {
		// biome-ignore lint/complexity/noUselessUndefined: explicit so every path returns a value (eslint consistent-return)
		return undefined;
	}
	return {
		used: asNumber(value.tokens),
		size: asNumber(value.contextWindow),
		pct: asNumber(value.percent),
	};
}

/**
 * Parses a `get_session_stats` RPC response into the snapshot's
 * tokens/cost/context fields, or `null` if `raw` isn't a successful
 * `get_session_stats` response.
 *
 * ASSUMPTION (unverified — no `pi` binary available in this sandbox; shape
 * per https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/rpc.md):
 * `data` is `{tokens: {input, output, cacheRead, cacheWrite}, cost,
 * contextUsage: {tokens, contextWindow, percent}}`, `cost` in USD. Reverify
 * against the installed pi version before relying on this.
 */
export function normalizePiSessionStats(raw: unknown): PiSessionStats | null {
	const data = piResponseData(raw, "get_session_stats");
	if (!data) {
		return null;
	}
	return {
		tokens: parsePiTokens(data.tokens),
		costUsd: asNumber(data.cost),
		contextUsage: parsePiContextUsage(data.contextUsage),
	};
}

/**
 * Parses a `get_state` RPC response's `isStreaming` into the snapshot's
 * `running` flag, or `undefined` if `raw` isn't a successful `get_state`
 * response carrying the boolean. Ref: rpc.md §get_state (`isStreaming` —
 * "Agent actively generating"), same source as `normalizePiStateModel`.
 */
export function normalizePiStateRunning(raw: unknown): boolean | undefined {
	const data = piResponseData(raw, "get_state");
	if (data === null || typeof data.isStreaming !== "boolean") {
		// biome-ignore lint/complexity/noUselessUndefined: explicit so every path returns a value (eslint consistent-return)
		return undefined;
	}
	return data.isStreaming;
}
