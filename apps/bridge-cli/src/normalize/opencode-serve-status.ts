// opencode serve: parses `GET /session/:id/message`'s response into the
// status-snapshot's tokens/cost/model fields — the serve counterpart to
// normalize/opencode-status.ts's ACP usage_update parse. Kept beside
// normalize/opencode-serve.ts (mirrors pi-status.ts/codex-status.ts) so
// neither file exceeds the repo's 300-line cap; consumed by the
// opencodeServeAdapter's getStatus (adapters/opencode-serve.ts).
//
// ASSUMPTION (unverified — no `opencode` binary in this sandbox; endpoint per
// docs/remote-control-plan.md §3.3, "opencode-serve `GET /session/:id/
// message` for tokens+cost"; response shape inferred from the same per-
// message `cost`/`tokens` fields `normalizeServeStepFinish` already assumes
// for the SSE step-finish part, see normalize/opencode-serve.ts): the
// endpoint returns an array of `{ info: { role, providerID?, modelID?,
// cost?, tokens?: { input, output, reasoning, cache: { read, write } } },
// parts: [...] }` entries (opencode's own per-message shape) — the snapshot
// is built from the LAST entry whose `info.role` is `"assistant"`. Reverify
// against a real `opencode serve` before relying on any exact field name.

import type { StatusSnapshotTokens } from "../adapters/types";
import { asString, isRecord } from "./types";

/** What `parseOpencodeServeStatus` extracts — field names already match
 * `StatusSnapshotDetail` (see ../adapters/types.ts). */
export interface OpencodeServeStatus {
	costUsd?: number;
	model?: string;
	tokens?: StatusSnapshotTokens;
}

function asNumber(value: unknown): number | undefined {
	return typeof value === "number" ? value : undefined;
}

function parseTokens(value: unknown): StatusSnapshotTokens | undefined {
	if (!isRecord(value)) {
		// biome-ignore lint/complexity/noUselessUndefined: explicit so every path returns a value (eslint consistent-return)
		return undefined;
	}
	const cache = isRecord(value.cache) ? value.cache : {};
	return {
		input: asNumber(value.input),
		output: asNumber(value.output),
		cacheRead: asNumber(cache.read),
		cacheWrite: asNumber(cache.write),
	};
}

/** `providerID`/`modelID` joined into the same "provider/model" string the
 * adapter's own `setModel`/model list already use (see opencode-serve.ts). */
function parseModel(info: Record<string, unknown>): string | undefined {
	const provider = asString(info.providerID);
	const model = asString(info.modelID);
	return provider === undefined || model === undefined
		? undefined
		: `${provider}/${model}`;
}

function isAssistantEntry(
	value: unknown
): value is { info: Record<string, unknown> } {
	return (
		isRecord(value) && isRecord(value.info) && value.info.role === "assistant"
	);
}

/** The most recent assistant message's `info` object — the one carrying the
 * session's latest cost/tokens — or `undefined` if `raw` isn't an array or
 * has no assistant entry at all. */
function lastAssistantInfo(raw: unknown): Record<string, unknown> | undefined {
	return Array.isArray(raw) ? raw.findLast(isAssistantEntry)?.info : undefined;
}

/** Maps a `GET /session/:id/message` response into the status snapshot's
 * fields — every field absent (`{}`) if `raw` carries no assistant message
 * to read them from. */
export function parseOpencodeServeStatus(raw: unknown): OpencodeServeStatus {
	const info = lastAssistantInfo(raw);
	if (!info) {
		return {};
	}
	return {
		model: parseModel(info),
		costUsd: asNumber(info.cost),
		tokens: parseTokens(info.tokens),
	};
}
