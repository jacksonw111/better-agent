// pi: `pi --mode rpc` — a long-lived process speaking a custom (not JSON-RPC
// 2.0) newline-delimited JSON protocol over stdio: commands sent on stdin are
// tagged by a `type` string (optionally an `id` for correlation), and so are
// the events/command-responses it writes back on stdout — there's no
// `method`/`result`/`error` envelope to reuse `jsonrpc-io.ts` for, so this
// mirrors claude-code.ts's plain `spawnProcessIo` wiring instead.
//
// ASSUMPTION (unverified — no `pi` binary available in this sandbox; shapes
// per https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/rpc.md
// and docs/json.md): pi has **no built-in per-tool-call approval/permission
// protocol at all ("No permission popups. Run in a container, or build your
// own confirmation flow with extensions...", per its docs) — bash/tool calls
// run ungated, unlike codex/opencode/claude-code (see terminal-header.tsx's
// `NoApprovalGateBadge`, driven by `agent-capabilities.ts`'s `noApprovalGate`).
// RC-T4: pi extensions CAN ask the user something via a separate
// `extension_ui_request`/`extension_ui_response` sub-protocol (VERIFIED
// against rpc.md, see `normalizePiExtensionUiRequest` below) — this is not a
// tool-permission gate, just an extension-driven dialog, but it must still
// never hang, so `select`/`confirm` requests DO map to an `ApprovalEvent`
// here. Reverify the event field names below against the installed pi
// version before relying on them.

import {
	type ApprovalEvent,
	type ApprovalOption,
	asString,
	isRecord,
	NO_EVENTS,
	type NormalizedEvent,
	type ToolEvent,
} from "./types";

function normalizePiTextDelta(
	assistantMessageEvent: Record<string, unknown>
): NormalizedEvent[] {
	if (assistantMessageEvent.type !== "text_delta") {
		return NO_EVENTS;
	}
	const text = asString(assistantMessageEvent.delta);
	return text === undefined ? NO_EVENTS : [{ kind: "output", text }];
}

function normalizePiMessageUpdate(
	raw: Record<string, unknown>
): NormalizedEvent[] {
	return isRecord(raw.assistantMessageEvent)
		? normalizePiTextDelta(raw.assistantMessageEvent)
		: NO_EVENTS;
}

function normalizePiContentBlock(block: unknown): NormalizedEvent[] {
	if (!isRecord(block) || typeof block.type !== "string") {
		return NO_EVENTS;
	}
	if (block.type === "text") {
		// Already streamed live via `message_update` text_delta output — the
		// final message repeats the whole text, so drop it here to avoid
		// rendering the reply twice.
		return NO_EVENTS;
	}
	if (block.type === "thinking") {
		const text = asString(block.thinking);
		return text === undefined
			? NO_EVENTS
			: [{ kind: "message", role: "assistant", text, thinking: true }];
	}
	// "toolCall" blocks are deliberately skipped: `tool_execution_start/end`
	// already cover the same tool call, and re-emitting it here would double it.
	return NO_EVENTS;
}

/** Maps a `message_end` event's final `message.content` — a string or an
 * array of text/thinking/toolCall blocks — to normalized message events. Only
 * `role: "assistant"` messages carry content worth surfacing here; user/
 * toolResult/bashExecution messages either originated from us or are already
 * covered by `tool_execution_*` events. */
function normalizePiMessageEnd(
	raw: Record<string, unknown>
): NormalizedEvent[] {
	const message = raw.message;
	if (!isRecord(message) || message.role !== "assistant") {
		return NO_EVENTS;
	}
	const content = message.content;
	if (typeof content === "string") {
		return content === ""
			? NO_EVENTS
			: [{ kind: "message", role: "assistant", text: content }];
	}
	if (!Array.isArray(content)) {
		return NO_EVENTS;
	}
	return content.flatMap(normalizePiContentBlock);
}

function normalizePiToolStart(raw: Record<string, unknown>): NormalizedEvent[] {
	const id = asString(raw.toolCallId);
	const name = asString(raw.toolName);
	return id === undefined || name === undefined
		? NO_EVENTS
		: [{ kind: "tool", id, name, status: "started", input: raw.args }];
}

/** `tool_execution_update` carries a `partialResult` while the tool is still
 * running — surfaced as another "started" tool event (there's no
 * "in-progress" status in `ToolEvent`) with that partial output attached. */
function normalizePiToolUpdate(
	raw: Record<string, unknown>
): NormalizedEvent[] {
	const id = asString(raw.toolCallId);
	const name = asString(raw.toolName);
	return id === undefined || name === undefined
		? NO_EVENTS
		: [
				{
					kind: "tool",
					id,
					name,
					status: "started",
					input: raw.args,
					output: raw.partialResult,
				},
			];
}

function normalizePiToolEnd(raw: Record<string, unknown>): NormalizedEvent[] {
	const id = asString(raw.toolCallId);
	const name = asString(raw.toolName);
	if (id === undefined || name === undefined) {
		return NO_EVENTS;
	}
	const status: ToolEvent["status"] = raw.isError ? "failed" : "completed";
	return [{ kind: "tool", id, name, status, output: raw.result }];
}

function normalizePiResponse(raw: Record<string, unknown>): NormalizedEvent[] {
	if (raw.success !== false) {
		return NO_EVENTS;
	}
	const command = asString(raw.command) ?? "command";
	const message = asString(raw.error) ?? `pi ${command} failed`;
	return [{ kind: "error", message, detail: raw.error }];
}

function normalizePiExtensionError(
	raw: Record<string, unknown>
): NormalizedEvent[] {
	const message = asString(raw.error) ?? "pi extension error";
	return [{ kind: "error", message, detail: raw }];
}

// --- extension_ui_request (RC-T4) -------------------------------------------
//
// Only `select`/`confirm` have a finite, nameable set of choices, so only
// those two map to an `ApprovalEvent` here; `input`/`editor` ask for
// free-form text (no deny analog) and are auto-cancelled immediately by
// `adapters/pi-approvals.ts` instead of ever reaching this function as a
// card — see `buildPiExtensionUiCancelResponse`'s doc comment
// (normalize/pi-commands.ts) for the full request/response shape reference.

const PI_CONFIRM_OPTIONS: ApprovalOption[] = [
	{ id: "confirmed", label: "Confirm" },
	{ id: "declined", label: "Decline" },
];

function piSelectOptions(raw: Record<string, unknown>): ApprovalOption[] {
	if (!Array.isArray(raw.options)) {
		return [];
	}
	return raw.options
		.filter((option): option is string => typeof option === "string")
		.map((label) => ({ id: label, label }));
}

/**
 * Maps an `extension_ui_request` whose `method` is `select` or `confirm` to
 * an `ApprovalEvent`; `[]` for `input`/`editor`, a malformed `select` with no
 * usable string options, or any non-matching line.
 */
export function normalizePiExtensionUiRequest(
	raw: Record<string, unknown>
): ApprovalEvent[] {
	// NO_EVENTS isn't reused here (unlike normalizePi below): it's typed
	// `NormalizedEvent[]`, too broad for this function's `ApprovalEvent[]`
	// return type.
	if (raw.type !== "extension_ui_request" || typeof raw.id !== "string") {
		return [];
	}
	if (raw.method !== "select" && raw.method !== "confirm") {
		return [];
	}
	const options =
		raw.method === "select" ? piSelectOptions(raw) : PI_CONFIRM_OPTIONS;
	if (options.length === 0) {
		return [];
	}
	return [
		{
			detail: asString(raw.message),
			kind: "approval",
			options,
			requestId: raw.id,
			title: asString(raw.title) ?? "pi extension needs an answer",
		},
	];
}

type PiEventHandler = (raw: Record<string, unknown>) => NormalizedEvent[];

const PI_STATUS_TYPES = new Set([
	"agent_start",
	"agent_end",
	"turn_start",
	"turn_end",
	"queue_update",
	"compaction_start",
	"compaction_end",
	"auto_retry_start",
	"auto_retry_end",
]);

const PI_EVENT_HANDLERS: Record<string, PiEventHandler> = {
	message_update: normalizePiMessageUpdate,
	message_end: normalizePiMessageEnd,
	tool_execution_start: normalizePiToolStart,
	tool_execution_update: normalizePiToolUpdate,
	tool_execution_end: normalizePiToolEnd,
	response: normalizePiResponse,
	extension_error: normalizePiExtensionError,
};

/** Maps one parsed line of `pi --mode rpc`'s stdout to normalized events. */
export function normalizePi(raw: unknown): NormalizedEvent[] {
	if (!isRecord(raw) || typeof raw.type !== "string") {
		return NO_EVENTS;
	}
	if (PI_STATUS_TYPES.has(raw.type)) {
		return [{ kind: "status", status: raw.type, detail: raw }];
	}
	const handler = PI_EVENT_HANDLERS[raw.type];
	return handler ? handler(raw) : NO_EVENTS;
}
