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
// against rpc.md, see `normalizePiExtensionUiRequest` in
// pi-extension-ui.ts) — this is not a tool-permission gate, just an
// extension-driven dialog, but it must still
// never hang, so `select`/`confirm` requests DO map to an `ApprovalEvent`
// here. Reverify the event field names below against the installed pi
// version before relying on them.

import { type BoundedCache, createBoundedCache } from "./bounded-cache";
import { createToolDurationTracker, withToolDuration } from "./tool-timing";
import {
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

/** Flattens `tool_execution_update`'s `partialResult` — a string, or an
 * object shaped roughly like a tool result (`text`/`output`/`result`) — into
 * plain preview text. Anything else falls back to `JSON.stringify` so a
 * shape drift degrades to *some* preview rather than none. */
function flattenPiPreview(value: unknown): string | undefined {
	if (typeof value === "string") {
		return value;
	}
	if (isRecord(value)) {
		return (
			asString(value.text) ??
			asString(value.output) ??
			asString(value.result) ??
			JSON.stringify(value)
		);
	}
	return value === undefined || value === null
		? undefined
		: JSON.stringify(value);
}

/** `tool_execution_update {toolCallId, partialResult}` carries a RUNNING
 * tool's latest partial output — surfaced as another "started" tool event
 * (there's no "in-progress" status in `ToolEvent`) with that output attached
 * as `preview` (REPLACE semantics: each update is the tool's full output so
 * far, not a delta to append — this function never accumulates across
 * calls, and neither should a consumer).
 *
 * ASSUMPTION (unverified, no `pi` binary in this sandbox — shape per
 * docs/json.md): unlike `tool_execution_start`/`_end`, this event carries no
 * `toolName` of its own, so the name is recalled from `toolNames` —
 * populated by `createPiNormalizer` on the matching `tool_execution_start`.
 * An update for an id the cache never saw a start for degrades to
 * `NO_EVENTS` (a blank/nameless tool card would be worse than none). */
function normalizePiToolUpdate(
	raw: Record<string, unknown>,
	toolNames: BoundedCache<string>
): NormalizedEvent[] {
	const id = asString(raw.toolCallId);
	const name = id === undefined ? undefined : toolNames.get(id);
	return id === undefined || name === undefined
		? NO_EVENTS
		: [
				{
					kind: "tool",
					id,
					name,
					status: "started",
					preview: flattenPiPreview(raw.partialResult),
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

// `extension_ui_request` (RC-T4) mapping lives in pi-extension-ui.ts, split
// out to keep this file under the 300-line cap; re-exported here so existing
// imports of `normalizePiExtensionUiRequest` from "./pi" keep working.
export { normalizePiExtensionUiRequest } from "./pi-extension-ui";

type PiEventHandler = (raw: Record<string, unknown>) => NormalizedEvent[];

const PI_STATUS_TYPES = new Set([
	"agent_start",
	"agent_end",
	// R2-T3 item 3: `agent_end` can be followed by auto-retries, so it's NOT
	// the true end-of-turn signal — `agent_settled` is (see
	// session-watchdog.ts's `TURN_END_STATUSES` and adapters/pi-streaming.ts,
	// which both key off this same status). Kept alongside `agent_end` rather
	// than replacing it, for compat with anything already watching for
	// `agent_end`.
	"agent_settled",
	"turn_start",
	"turn_end",
	"queue_update",
	"compaction_start",
	"compaction_end",
	"auto_retry_start",
	"auto_retry_end",
]);

// `tool_execution_update` is deliberately absent here: it needs the
// `toolNames` cache `createPiNormalizer` maintains (see
// `normalizePiToolUpdate`'s doc comment), which this stateless dispatch has
// no access to — handled separately by `createPiNormalizer` below, keyed off
// the SAME raw.type before it ever reaches this table.
const PI_EVENT_HANDLERS: Record<string, PiEventHandler> = {
	message_update: normalizePiMessageUpdate,
	message_end: normalizePiMessageEnd,
	tool_execution_start: normalizePiToolStart,
	tool_execution_end: normalizePiToolEnd,
	response: normalizePiResponse,
	extension_error: normalizePiExtensionError,
};

/** Maps one parsed line of `pi --mode rpc`'s stdout to normalized events.
 * Stateless — `tool_execution_update` (which needs the start-event name
 * cache) and tool duration always fall through to `NO_EVENTS`/no duration
 * here; use `createPiNormalizer` for the full, stateful mapping. */
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

/** R1-T2: the stateful entry point `adapters/pi.ts` uses instead of the pure
 * `normalizePi` — adds two things the plain dispatch can't, both keyed by
 * `toolCallId` in bounded per-session caches (see bounded-cache.ts):
 *   - `tool_execution_update` → a `preview`-carrying tool event, using the
 *     name recorded at the matching `tool_execution_start` (see
 *     `normalizePiToolUpdate`'s doc comment).
 *   - `durationMs` on every `tool_execution_end`, measured from the matching
 *     `tool_execution_start` (see tool-timing.ts). */
export function createPiNormalizer(): (raw: unknown) => NormalizedEvent[] {
	const toolNames = createBoundedCache<string>();
	const durations = createToolDurationTracker();
	return (raw: unknown): NormalizedEvent[] => {
		if (!isRecord(raw) || typeof raw.type !== "string") {
			return NO_EVENTS;
		}
		if (raw.type === "tool_execution_start") {
			const id = asString(raw.toolCallId);
			const name = asString(raw.toolName);
			if (id !== undefined && name !== undefined) {
				toolNames.set(id, name);
			}
		}
		if (raw.type === "tool_execution_update") {
			return normalizePiToolUpdate(raw, toolNames);
		}
		if (raw.type === "tool_execution_end") {
			const id = asString(raw.toolCallId);
			if (id !== undefined) {
				toolNames.delete(id);
			}
		}
		return normalizePi(raw).map((event) => withToolDuration(durations, event));
	};
}
