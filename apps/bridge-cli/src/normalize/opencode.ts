// opencode: `opencode acp` — the Agent Client Protocol (ACP,
// https://agentclientprotocol.com) server built into the opencode CLI,
// speaking newline-delimited JSON-RPC over stdio. We only need the
// `session/update` notification stream here; requests (`initialize`,
// `session/new`, `session/prompt`) are issued by the adapter, not mapped here.

import {
	type ApprovalEvent,
	type ApprovalOption,
	asString,
	isRecord,
	NO_EVENTS,
	type NormalizedEvent,
	type ToolEvent,
} from "./types";

interface AcpTextContent {
	text: string;
	type: "text";
}

function isAcpTextContent(value: unknown): value is AcpTextContent {
	return (
		isRecord(value) && value.type === "text" && typeof value.text === "string"
	);
}

function normalizeAcpToolCall(
	update: Record<string, unknown>,
	fallbackStatus: ToolEvent["status"]
): NormalizedEvent[] {
	const id = asString(update.toolCallId);
	if (id === undefined) {
		return NO_EVENTS;
	}
	const status =
		update.status === "completed" || update.status === "failed"
			? update.status
			: fallbackStatus;
	return [
		{
			kind: "tool",
			id,
			name: asString(update.title) ?? id,
			status,
			input: update.rawInput,
			output: update.content,
		},
	];
}

type AcpUpdateHandler = (update: Record<string, unknown>) => NormalizedEvent[];

function normalizeAcpMessageChunk(
	update: Record<string, unknown>
): NormalizedEvent[] {
	if (!isAcpTextContent(update.content)) {
		return NO_EVENTS;
	}
	// These are streaming CHUNKS (deltas), not whole messages — emit them as
	// `output` so the UI accumulates them into ONE bubble. Mapping each chunk
	// to a `message` would render every word as its own bubble.
	return [
		{
			kind: "output",
			text: update.content.text,
			reasoning: update.sessionUpdate === "agent_thought_chunk",
		},
	];
}

function normalizeAcpToolCallStarted(
	update: Record<string, unknown>
): NormalizedEvent[] {
	return normalizeAcpToolCall(update, "started");
}

function normalizeAcpToolCallCompleted(
	update: Record<string, unknown>
): NormalizedEvent[] {
	return normalizeAcpToolCall(update, "completed");
}

function normalizeAcpPlan(update: Record<string, unknown>): NormalizedEvent[] {
	return [{ kind: "status", status: "plan", detail: update.entries }];
}

/** opencode's ACP layer streams per-turn context/cost as a `usage_update`
 * `session/update` — a curated, known status (see `USAGE_UPDATE_STATUS` in
 * the web's bridge-session-status.ts and `opencode-status.ts`'s `getStatus`
 * cache), so it gets its own handler rather than falling into the
 * unknown-kind default below. */
function normalizeAcpUsageUpdate(
	update: Record<string, unknown>
): NormalizedEvent[] {
	return [
		{ kind: "status", status: update.sessionUpdate as string, detail: update },
	];
}

/** Dispatch table for every `sessionUpdate` kind this normalizer knows about
 * — a lookup instead of a `switch` so `normalizeAcpUpdate` itself stays a
 * flat, low-complexity dispatcher no matter how many kinds get added. */
const ACP_UPDATE_HANDLERS: Record<string, AcpUpdateHandler> = {
	agent_message_chunk: normalizeAcpMessageChunk,
	agent_thought_chunk: normalizeAcpMessageChunk,
	tool_call: normalizeAcpToolCallStarted,
	tool_call_update: normalizeAcpToolCallCompleted,
	plan: normalizeAcpPlan,
	available_commands_update: normalizeAcpAvailableCommands,
	usage_update: normalizeAcpUsageUpdate,
};

/** Maps one ACP `session/update` notification's `update` payload. An
 * unrecognized `sessionUpdate` kind is DROPPED, mirroring opencode-serve's
 * documented policy (see `normalize/opencode-serve.ts`'s default case): this
 * notification stream is server-global and chatty, and newer opencode builds
 * keep adding sessionUpdate kinds this normalizer hasn't been taught yet.
 * Passing them through as status events used to flood the web feed AND split
 * every assistant reply into one bubble per unknown status (the opencode ACP
 * sentence-by-sentence regression — see bridge-turns.ts's `foldStatus`
 * docstring on the web side, which now also refuses to fragment on an
 * unknown status as defense in depth). */
function normalizeAcpUpdate(update: unknown): NormalizedEvent[] {
	if (!isRecord(update) || typeof update.sessionUpdate !== "string") {
		return NO_EVENTS;
	}
	const handler = ACP_UPDATE_HANDLERS[update.sessionUpdate];
	return handler ? handler(update) : NO_EVENTS;
}

// --- session_ready: available_commands_update -------------------------------
//
// Unlike claude-code's single init line, ACP has no dedicated "session ready"
// event — but opencode's ACP layer (verified by reading
// packages/opencode/src/acp/service.ts's `sendAvailableCommands` in the
// anomalyco/opencode repo at HEAD, not merely assumed like the shapes above)
// sends exactly one `available_commands_update` `session/update` notification
// per `session/new`/`session/load` call, scheduled via a `setTimeout(0)`
// fired after that call's response is already written — so by the time this
// notification arrives, the adapter's `session/new` request has already
// resolved and it can merge in the session id/cwd it already knows (see
// opencode.ts). Skills are NOT distinguishable here: opencode's internal
// command list tags skill-derived entries with `source: "skill"`, but
// `sendAvailableCommands` strips every field down to just `{name,
// description}` before it goes over the wire, so `skills` is deliberately
// left unset rather than guessed at.

interface AcpAvailableCommand {
	name: string;
}

function isAcpAvailableCommand(value: unknown): value is AcpAvailableCommand {
	return isRecord(value) && typeof value.name === "string";
}

function normalizeAcpAvailableCommands(
	update: Record<string, unknown>
): NormalizedEvent[] {
	if (!Array.isArray(update.availableCommands)) {
		return NO_EVENTS;
	}
	const slashCommands = update.availableCommands
		.filter(isAcpAvailableCommand)
		.map((command) => command.name);
	return [
		{ kind: "status", status: "session_ready", detail: { slashCommands } },
	];
}

/** Maps one parsed line of `opencode acp`'s stdout (JSON-RPC over stdio). */
export function normalizeOpencode(raw: unknown): NormalizedEvent[] {
	if (!isRecord(raw) || raw.method !== "session/update") {
		return NO_EVENTS;
	}
	const params = raw.params;
	return isRecord(params) ? normalizeAcpUpdate(params.update) : NO_EVENTS;
}

// --- Approval requests ------------------------------------------------------
//
// ASSUMPTION (unverified — no `opencode` binary is available in this
// sandbox; shape per the ACP spec, https://agentclientprotocol.com/protocol/schema,
// `RequestPermissionRequest`/`PermissionOption`): the request's `params.options`
// is an array of `{ optionId, name, kind }`, and the reply selects one via
// `{ outcome: { outcome: "selected", optionId } }`. Reverify against the
// installed opencode version before relying on this.

const APPROVAL_METHOD = "session/request_permission";

interface AcpPermissionOption {
	name: string;
	optionId: string;
}

function isAcpPermissionOption(value: unknown): value is AcpPermissionOption {
	return (
		isRecord(value) &&
		typeof value.optionId === "string" &&
		typeof value.name === "string"
	);
}

/**
 * RC-T4: the audited silent-hang bug — a `session/request_permission` whose
 * `params.options` was empty or entirely unparseable used to make this
 * normalizer return `[]`, same as a request that didn't match the method at
 * all. `adapters/opencode.ts`'s `wireOpencodeApprovals` treats an empty
 * result as "not an approval, ignore it" — so the request was NEVER
 * `rpc.respond`ed, and the tool call it gated blocked FOREVER: no card, no
 * timeout, nothing visible.
 *
 * Fix: such a request still gets a card, but with only ONE representable
 * choice — deny. There's no real ACP `optionId` behind an "allow" here (the
 * request offered none), so fabricating one would let a user "approve"
 * something this adapter could never actually select on the wire; offering
 * only deny keeps the fail-closed guarantee (never silently hangs, never
 * auto-allows) instead of lying about what a click does. This synthetic id is
 * never a real ACP optionId, so `wireOpencodeApprovals` uses it (see
 * `FALLBACK_DENY_OPTION_ID`'s export) to reply with `acpCancelledOutcome()`
 * rather than `acpSelectedOutcome()`, which requires a genuine optionId.
 */
export const FALLBACK_DENY_OPTION_ID = "unrepresentable-deny";

const FALLBACK_DENY_OPTIONS: ApprovalOption[] = [
	{ id: FALLBACK_DENY_OPTION_ID, label: "Deny (no answerable options)" },
];

function acpApprovalDetail(
	toolCall: Record<string, unknown>
): string | undefined {
	return toolCall.rawInput === undefined
		? undefined
		: JSON.stringify(toolCall.rawInput);
}

/**
 * Maps an ACP `session/request_permission` server-initiated *request* — an
 * `onRequest`-surfaced `(id, method, params)`, not an `onNotification` one —
 * to an `ApprovalEvent`, or `[]` if `method`/`params` don't match at all (not
 * this protocol's request — a real non-match, not the empty-options bug
 * below). Returns an array (rather than `ApprovalEvent | undefined`) to keep
 * every path returning a real value: biome's formatter collapses
 * `return undefined;` to a bare `return;`, which then trips eslint's
 * `consistent-return` against the sibling `return {…};` — see the identical
 * note in `use-bridge-connection-effects.ts`'s `noCleanup`. RC-T4: unlike a
 * genuine non-match, a request whose `options` are empty/unparseable is NOT
 * dropped here — see `FALLBACK_DENY_OPTIONS`'s doc comment above.
 */
export function normalizeOpencodeApprovalRequest(
	requestId: string,
	method: string,
	params: unknown
): ApprovalEvent[] {
	if (method !== APPROVAL_METHOD || !isRecord(params)) {
		return [];
	}
	const parsedOptions = Array.isArray(params.options)
		? params.options.filter(isAcpPermissionOption)
		: [];
	const options: ApprovalOption[] =
		parsedOptions.length === 0
			? FALLBACK_DENY_OPTIONS
			: parsedOptions.map((option) => ({
					id: option.optionId,
					label: option.name,
				}));
	const toolCall = isRecord(params.toolCall) ? params.toolCall : {};
	return [
		{
			detail: acpApprovalDetail(toolCall),
			kind: "approval",
			options,
			requestId,
			title: asString(toolCall.title) ?? "Approve action?",
		},
	];
}
