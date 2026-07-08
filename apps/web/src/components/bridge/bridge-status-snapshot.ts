// The `status_snapshot` curated status event — the normalized on-demand
// status surface answering a `{ control: getStatus }` request (see
// use-bridge-terminal-actions.ts). Split out of bridge-session-status.ts
// purely to keep that file under the repo's max-lines-per-file gate; reuses
// its exported defensive parse helpers so every curated status detail parses
// "trust nothing off the wire" the same way.
import type { StreamEvent } from "./bridge-events";
import {
	asOptionalMcpServers,
	asOptionalNumber,
	asOptionalString,
	isRecord,
	latestStatusDetail,
	type McpServerStatus,
} from "./bridge-session-status";

/** Pushed by every adapter (claude-code/pi/opencode/codex) in reply to a `{
 * control: getStatus }` command — the normalized on-demand status surface
 * (mirrors `STATUS_SNAPSHOT_STATUS` in
 * `apps/bridge-cli/src/adapters/types.ts`). Rendered as the detail page's
 * on-demand status panel, refreshed on request rather than streamed. */
export const STATUS_SNAPSHOT_STATUS = "status_snapshot";

/** Context-window occupancy from a `status_snapshot` — `used`/`size` are
 * token counts, `pct` is the agent-reported (or adapter-derived) used/size
 * percentage, 0–100. Mirrors `StatusSnapshotContextUsage` in
 * `apps/bridge-cli/src/adapters/types.ts`. */
export interface StatusSnapshotContextUsage {
	pct?: number;
	size?: number;
	used?: number;
}

/** Session-total token buckets on a `status_snapshot` — each optional since
 * not every agent reports every bucket (e.g. codex has no cache-write
 * figure). Mirrors `StatusSnapshotTokens` in
 * `apps/bridge-cli/src/adapters/types.ts`. */
export interface StatusSnapshotTokens {
	cacheRead?: number;
	cacheWrite?: number;
	input?: number;
	output?: number;
}

/** The normalized on-demand status model, answering a `{ control: getStatus
 * }` request: every field optional, each adapter fills exactly what its agent
 * can answer. Mirrors `StatusSnapshotDetail` in
 * `apps/bridge-cli/src/adapters/types.ts` field-for-field — keep the two in
 * sync. */
export interface StatusSnapshotDetail {
	contextUsage?: StatusSnapshotContextUsage;
	costUsd?: number;
	mcpServers?: McpServerStatus[];
	model?: string;
	permissionMode?: string;
	/** True while the agent is actively generating; absent when the agent
	 * doesn't report it. */
	running?: boolean;
	tokens?: StatusSnapshotTokens;
}

function asOptionalStatusContextUsage(
	value: unknown
): StatusSnapshotContextUsage | undefined {
	if (!isRecord(value)) {
		// biome-ignore lint/complexity/noUselessUndefined: explicit so every path returns a value (eslint consistent-return)
		return undefined;
	}
	return {
		used: asOptionalNumber(value.used),
		size: asOptionalNumber(value.size),
		pct: asOptionalNumber(value.pct),
	};
}

function asOptionalStatusTokens(
	value: unknown
): StatusSnapshotTokens | undefined {
	if (!isRecord(value)) {
		// biome-ignore lint/complexity/noUselessUndefined: explicit so every path returns a value (eslint consistent-return)
		return undefined;
	}
	return {
		input: asOptionalNumber(value.input),
		output: asOptionalNumber(value.output),
		cacheRead: asOptionalNumber(value.cacheRead),
		cacheWrite: asOptionalNumber(value.cacheWrite),
	};
}

/** Parses a `status_snapshot` detail defensively — same "trust nothing"
 * posture as `parseSessionReadyDetail`/`parseUsageUpdateDetail`: every field
 * that doesn't match its expected shape becomes `undefined` rather than
 * throwing, so a malformed or partial reply from one adapter still renders
 * whatever DID come through. */
export function parseStatusSnapshotDetail(
	detail: unknown
): StatusSnapshotDetail | null {
	if (!isRecord(detail)) {
		return null;
	}
	return {
		model: asOptionalString(detail.model),
		permissionMode: asOptionalString(detail.permissionMode),
		running: typeof detail.running === "boolean" ? detail.running : undefined,
		costUsd: asOptionalNumber(detail.costUsd),
		contextUsage: asOptionalStatusContextUsage(detail.contextUsage),
		tokens: asOptionalStatusTokens(detail.tokens),
		mcpServers: asOptionalMcpServers(detail.mcpServers),
	};
}

/** The latest `status_snapshot` detail on the feed — `null` before a `{
 * control: getStatus }` request has gotten a reply (or the reply was
 * malformed). */
export function latestStatusSnapshotDetail(
	events: StreamEvent[]
): StatusSnapshotDetail | null {
	const detail = latestStatusDetail(events, STATUS_SNAPSHOT_STATUS);
	return detail === undefined ? null : parseStatusSnapshotDetail(detail);
}
