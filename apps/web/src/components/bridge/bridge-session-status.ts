// Curated metadata carried by two `status` events the CLI's normalize layer
// emits (see `apps/bridge-cli/src/normalize/claude-code.ts`): `session_ready`
// (once, at session init — model/cwd/capabilities) and `turn_usage` (once per
// completed turn — cost/tokens). Both are session METADATA, not chat
// messages, so they're kept out of `BridgeTurn`/the message list entirely
// (see bridge-turns.ts) and instead surfaced as dedicated header/chip UI,
// each always showing the LATEST detail seen on the feed.
import type { StreamEvent } from "./bridge-events";

/** `StatusEvent.status` value naming each curated event — checked by
 * `bridge-turns.ts` to exclude them from the rendered turn list, and by the
 * `latest*` finders below to pick them back out of the raw feed. */
export const SESSION_READY_STATUS = "session_ready";
export const TURN_USAGE_STATUS = "turn_usage";
/** Pushed by the claude adapter in reply to a `{ control: listSessions }`
 * command (see `apps/bridge-cli/src/adapters/claude-code.ts`'s
 * `makeListSessions`) — the "Past conversations" picker's data. */
export const SESSION_LIST_STATUS = "session_list";
/** opencode (ACP) emits its evolving task list as a `plan` status update whose
 * `detail` is the list of entries — rendered as a todolist, not a status line. */
export const PLAN_STATUS = "plan";
/** opencode (ACP) streams per-turn context/cost as a `usage_update`
 * `session/update` (the normalize layer's default case passes it through as a
 * `status` event). Rendered as a small, faded one-liner above the composer. */
export const USAGE_UPDATE_STATUS = "usage_update";

interface McpServerStatus {
	name: string;
	status: string;
}

export interface SessionReadyDetail {
	cwd?: string;
	mcpServers?: McpServerStatus[];
	model?: string;
	/** The model ids this agent reports it can switch between (claude's SDK
	 * `supportedModels()`; other agents leave it unset). The composer's model
	 * menu lists exactly these and is hidden when absent/empty. */
	models?: string[];
	permissionMode?: string;
	/** Claude's own conversation id for this session (its `session_id`),
	 * captured off the SDK's init event — also persisted server-side onto the
	 * bridge_sessions row (see `packages/api/src/routers/bridge.ts`'s
	 * `maybePersistAgentSessionId`) so a later `--resume` can reopen this exact
	 * conversation. */
	sessionId?: string;
	skills?: string[];
	slashCommands?: string[];
	tools?: string[];
}

/** One past local conversation the "Past conversations" picker renders —
 * mirrors `SessionListItem` in
 * `apps/bridge-cli/src/adapters/claude-code.ts`. */
export interface SessionListItem {
	cwd?: string;
	gitBranch?: string;
	id: string;
	lastModified?: number;
	title: string;
}

export interface SessionListDetail {
	sessions: SessionListItem[];
}

interface TurnUsageTokens {
	cacheCreationInputTokens?: number;
	cacheReadInputTokens?: number;
	inputTokens?: number;
	outputTokens?: number;
}

export interface TurnUsageDetail {
	costUsd?: number;
	durationMs?: number;
	isError?: boolean;
	numTurns?: number;
	usage?: TurnUsageTokens;
}

/** One entry in opencode's streamed `usage_update` cost figure. */
export interface UsageUpdateCost {
	amount?: number;
	currency?: string;
}

/** opencode's per-turn context window + cost, streamed mid-turn as a
 * `usage_update` status. `used`/`size` are token counts; the context % is
 * derived client-side as used/size. */
export interface UsageUpdateDetail {
	cost?: UsageUpdateCost;
	size?: number;
	used?: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asOptionalString(value: unknown): string | undefined {
	return typeof value === "string" ? value : undefined;
}

function asOptionalNumber(value: unknown): number | undefined {
	return typeof value === "number" ? value : undefined;
}

function asOptionalStringArray(value: unknown): string[] | undefined {
	return Array.isArray(value) &&
		value.every((item): item is string => typeof item === "string")
		? value
		: undefined;
}

function asOptionalMcpServers(value: unknown): McpServerStatus[] | undefined {
	if (!Array.isArray(value)) {
		// biome-ignore lint/complexity/noUselessUndefined: explicit so every path returns a value (eslint consistent-return)
		return undefined;
	}
	const servers: McpServerStatus[] = [];
	for (const item of value) {
		if (isRecord(item) && typeof item.name === "string") {
			servers.push({
				name: item.name,
				status: asOptionalString(item.status) ?? "unknown",
			});
		}
	}
	return servers;
}

function parseSessionReadyDetail(detail: unknown): SessionReadyDetail | null {
	if (!isRecord(detail)) {
		return null;
	}
	return {
		model: asOptionalString(detail.model),
		models: asOptionalStringArray(detail.models),
		cwd: asOptionalString(detail.cwd),
		permissionMode: asOptionalString(detail.permissionMode),
		sessionId: asOptionalString(detail.sessionId),
		tools: asOptionalStringArray(detail.tools),
		slashCommands: asOptionalStringArray(detail.slashCommands),
		skills: asOptionalStringArray(detail.skills),
		mcpServers: asOptionalMcpServers(detail.mcpServers),
	};
}

function asOptionalSessionListItems(
	value: unknown
): SessionListItem[] | undefined {
	if (!Array.isArray(value)) {
		// biome-ignore lint/complexity/noUselessUndefined: explicit so every path returns a value (eslint consistent-return)
		return undefined;
	}
	const items: SessionListItem[] = [];
	for (const item of value) {
		if (isRecord(item) && typeof item.id === "string") {
			items.push({
				id: item.id,
				title: asOptionalString(item.title) ?? item.id,
				lastModified: asOptionalNumber(item.lastModified),
				gitBranch: asOptionalString(item.gitBranch),
				cwd: asOptionalString(item.cwd),
			});
		}
	}
	return items;
}

function parseSessionListDetail(detail: unknown): SessionListDetail | null {
	if (!isRecord(detail)) {
		return null;
	}
	const sessions = asOptionalSessionListItems(detail.sessions);
	return sessions === undefined ? null : { sessions };
}

function parseUsageTokens(value: unknown): TurnUsageTokens | undefined {
	if (!isRecord(value)) {
		// biome-ignore lint/complexity/noUselessUndefined: explicit so every path returns a value (eslint consistent-return)
		return undefined;
	}
	// claude's result line passes its SDK `usage` object through verbatim
	// (see normalize/claude-code.ts's `normalizeClaudeResult`), whose keys are
	// snake_case (`input_tokens`, `cache_read_input_tokens`, …) — NOT camelCase.
	// Reading camelCase here left every token bucket permanently undefined.
	return {
		cacheCreationInputTokens: asOptionalNumber(
			value.cache_creation_input_tokens
		),
		cacheReadInputTokens: asOptionalNumber(value.cache_read_input_tokens),
		inputTokens: asOptionalNumber(value.input_tokens),
		outputTokens: asOptionalNumber(value.output_tokens),
	};
}

function parseTurnUsageDetail(detail: unknown): TurnUsageDetail | null {
	if (!isRecord(detail)) {
		return null;
	}
	return {
		costUsd: asOptionalNumber(detail.costUsd),
		numTurns: asOptionalNumber(detail.numTurns),
		durationMs: asOptionalNumber(detail.durationMs),
		usage: parseUsageTokens(detail.usage),
		isError: typeof detail.isError === "boolean" ? detail.isError : undefined,
	};
}

function parseUsageUpdateCost(value: unknown): UsageUpdateCost | undefined {
	if (!isRecord(value)) {
		// biome-ignore lint/complexity/noUselessUndefined: explicit so every path returns a value (eslint consistent-return)
		return undefined;
	}
	return {
		amount: asOptionalNumber(value.amount),
		currency: asOptionalString(value.currency),
	};
}

function parseUsageUpdateDetail(detail: unknown): UsageUpdateDetail | null {
	if (!isRecord(detail)) {
		return null;
	}
	return {
		used: asOptionalNumber(detail.used),
		size: asOptionalNumber(detail.size),
		cost: parseUsageUpdateCost(detail.cost),
	};
}

/** Finds the most recent status event of the given curated `status` name and
 * parses its detail — `undefined` if none has arrived yet, `null` if one
 * arrived but its detail didn't match the expected shape. Scans from the
 * tail since "most recent" is what every caller wants. */
function latestStatusDetail(events: StreamEvent[], status: string): unknown {
	for (let index = events.length - 1; index >= 0; index -= 1) {
		const { event } = events[index];
		if (event.kind === "status" && event.status === status) {
			return event.detail;
		}
	}
	// biome-ignore lint/complexity/noUselessUndefined: explicit so every path returns a value (eslint consistent-return)
	return undefined;
}

/** The latest `session_ready` detail on the feed, or `null` if none has
 * arrived (or the one that did was malformed). */
export function latestSessionReadyDetail(
	events: StreamEvent[]
): SessionReadyDetail | null {
	const detail = latestStatusDetail(events, SESSION_READY_STATUS);
	return detail === undefined ? null : parseSessionReadyDetail(detail);
}

/** The latest `turn_usage` detail on the feed, or `null` if no turn has
 * completed yet (or the one that did was malformed). */
export function latestTurnUsageDetail(
	events: StreamEvent[]
): TurnUsageDetail | null {
	const detail = latestStatusDetail(events, TURN_USAGE_STATUS);
	return detail === undefined ? null : parseTurnUsageDetail(detail);
}

/** The latest `usage_update` detail on the feed (opencode's streamed
 * context/cost), or `null` if none has arrived yet (or it was malformed). */
export function latestUsageUpdateDetail(
	events: StreamEvent[]
): UsageUpdateDetail | null {
	const detail = latestStatusDetail(events, USAGE_UPDATE_STATUS);
	return detail === undefined ? null : parseUsageUpdateDetail(detail);
}

/** The latest `session_list` detail on the feed — `null` before a `{
 * control: listSessions }` request has gotten a reply (or the reply was
 * malformed). */
export function latestSessionListDetail(
	events: StreamEvent[]
): SessionListDetail | null {
	const detail = latestStatusDetail(events, SESSION_LIST_STATUS);
	return detail === undefined ? null : parseSessionListDetail(detail);
}
