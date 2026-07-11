// codex: `codex app-server` — a long-lived JSON-RPC 2.0 process over stdio
// (the "jsonrpc" version field is omitted on the wire). We drive it with
// `thread/start` + `turn/start` requests and map the `item/*` and `turn/*`
// notifications streamed back during a turn. See
// https://developers.openai.com/codex/app-server for the protocol reference.

import {
	normalizeCodexMcpToolCallItem,
	normalizeCodexReasoningItem,
} from "./codex-items";
import { createToolDurationTracker, withToolDuration } from "./tool-timing";
import {
	asString,
	isArrayOf,
	isRecord,
	NO_EVENTS,
	type NormalizedEvent,
} from "./types";

function isFileChangePath(path: unknown): path is string {
	return typeof path === "string";
}

/** Some codex builds tear a turn down by emitting a raw `<turn_aborted>` (or
 * self-closing `<turn_aborted/>`) marker as literal agentMessage text —
 * instead of a clean `turn/completed` notification — when an interrupt or
 * upstream error short-circuits the normal completion path. Detecting the
 * marker and synthesizing the same `turn_completed` status
 * `session-watchdog.ts`'s `TURN_END_STATUSES` (and the web's `bridge-
 * turns.ts`) already treat as turn-terminal keeps the turn from hanging
 * forever waiting for a `turn/completed` that will never arrive.
 *
 * Mirrors hermes's `codex_app_server_session.py`
 * (`_has_turn_aborted_marker`/`_TURN_ABORTED_MARKERS`), which verified this
 * behavior against a real codex 0.130.0 binary — this adapter has no codex
 * binary to reverify it against, so treat the marker text itself as
 * confirmed but this wiring as unexercised. */
const TURN_ABORTED_MARKERS = ["<turn_aborted>", "<turn_aborted/>"];

function hasTurnAbortedMarker(text: string): boolean {
	return TURN_ABORTED_MARKERS.some((marker) => text.includes(marker));
}

/** The synthetic terminal-status event to append whenever `text` contains a
 * `<turn_aborted>` marker — `NO_EVENTS` otherwise. Shared by the agentMessage
 * item handler and its streaming delta so the marker ends the turn cleanly
 * regardless of which notification it happens to land in. */
function turnAbortedEvents(text: string): NormalizedEvent[] {
	return hasTurnAbortedMarker(text)
		? [
				{
					kind: "status",
					status: "turn_completed",
					detail: { turnAborted: true },
				},
			]
		: NO_EVENTS;
}

function normalizeCodexFileChangeItem(
	item: Record<string, unknown>
): NormalizedEvent[] {
	const changes = item.changes;
	if (!Array.isArray(changes)) {
		return NO_EVENTS;
	}
	return changes.flatMap((entry): NormalizedEvent[] => {
		if (!(isRecord(entry) && isFileChangePath(entry.path))) {
			return NO_EVENTS;
		}
		const change =
			entry.kind === "created" || entry.kind === "deleted"
				? entry.kind
				: "modified";
		return [
			{ kind: "file", path: entry.path, change, diff: asString(entry.diff) },
		];
	});
}

function normalizeCodexCommandExecutionItem(
	item: Record<string, unknown>
): NormalizedEvent[] {
	const id = asString(item.id);
	if (id === undefined) {
		return NO_EVENTS;
	}
	const command = isArrayOf(
		item.command,
		(part): part is string => typeof part === "string"
	)
		? item.command.join(" ")
		: (asString(item.command) ?? "");
	return [
		{
			kind: "tool",
			id,
			name: "shell",
			status: item.status === "completed" ? "completed" : "started",
			input: command,
		},
	];
}

// A codex agentMessage materializes as a renderable `message` EXACTLY ONCE,
// on the terminal `item/completed` — mirroring hermes's `codex_event_projector`
// (`if method != "item/completed": return ProjectionResult()`), verified against
// a real codex binary. Two bugs this closes: (1) `item/started` carries the same
// item with EMPTY text, which rendered a blank assistant bubble ("empty
// output"); (2) the streaming deltas below used to emit their own renderable
// `output` events, which double-rendered the reply when the web couldn't prove
// they shared the final message's id ("repeated output"). Now only this
// terminal event is renderable, so neither can happen regardless of the wire's
// id conventions.
function normalizeCodexAgentMessageItem(
	item: Record<string, unknown>
): NormalizedEvent[] {
	const text = asString(item.text);
	if (text === undefined) {
		return NO_EVENTS;
	}
	return [
		{ id: asString(item.id), kind: "message", role: "assistant", text },
		...turnAbortedEvents(text),
	];
}

// Items whose content only materializes on the terminal `item/completed` —
// `item/started` carries the same item premature/empty (see
// normalizeCodexAgentMessageItem's doc comment). Kept as a lookup table
// (rather than more switch cases) to keep normalizeCodexItem's complexity
// under the repo's eslint gate.
const CODEX_TERMINAL_ONLY_ITEM_HANDLERS: Record<
	string,
	(item: Record<string, unknown>) => NormalizedEvent[]
> = {
	agentMessage: normalizeCodexAgentMessageItem,
	fileChange: normalizeCodexFileChangeItem,
	reasoning: normalizeCodexReasoningItem,
};

// `terminal` is true only for `item/completed`. commandExecution/mcpToolCall/
// dynamicToolCall are NOT terminal-gated — they carry their own `status` and
// dedup by id, so the same tool bubble updates in place across
// item/started → item/completed.
function normalizeCodexItem(
	item: unknown,
	terminal: boolean
): NormalizedEvent[] {
	if (!isRecord(item) || typeof item.type !== "string") {
		return NO_EVENTS;
	}
	if (item.type === "commandExecution") {
		return normalizeCodexCommandExecutionItem(item);
	}
	if (item.type === "mcpToolCall" || item.type === "dynamicToolCall") {
		return normalizeCodexMcpToolCallItem(item);
	}
	const terminalHandler = CODEX_TERMINAL_ONLY_ITEM_HANDLERS[item.type];
	return terminalHandler && terminal ? terminalHandler(item) : NO_EVENTS;
}

// Streaming deltas are DISPLAY-ONLY: the message materializes once on
// `item/completed` (see `normalizeCodexAgentMessageItem`). We deliberately emit
// NO renderable event for the delta text — only a `<turn_aborted>` marker that
// happens to land in a delta is honored, so the turn can still end cleanly.
function normalizeCodexAgentMessageDelta(
	params: Record<string, unknown>
): NormalizedEvent[] {
	const text = asString(params.delta);
	if (text === undefined) {
		return NO_EVENTS;
	}
	return turnAbortedEvents(text);
}

// Researched as a suspected dead path (plan §2: docs don't list a
// `turn/failed` notification), but codex.test.ts pins its mapping and the
// cost of keeping it is one tolerant handler — kept until a real codex
// binary confirms the protocol either way.
function normalizeCodexTurnFailed(
	params: Record<string, unknown>
): NormalizedEvent[] {
	const message = asString(params.error) ?? "codex turn failed";
	return [{ kind: "error", message, detail: params.error }];
}

type CodexNotificationHandler = (
	params: Record<string, unknown>
) => NormalizedEvent[];

const CODEX_NOTIFICATION_HANDLERS: Record<string, CodexNotificationHandler> = {
	"item/started": (params) => normalizeCodexItem(params.item, false),
	"item/completed": (params) => normalizeCodexItem(params.item, true),
	"item/agentMessage/delta": normalizeCodexAgentMessageDelta,
	"turn/started": (params) => [
		{ kind: "status", status: "turn_started", detail: params.turn },
	],
	"turn/completed": (params) => [
		{ kind: "status", status: "turn_completed", detail: params.turn },
	],
	"turn/failed": normalizeCodexTurnFailed,
};

// --- Status snapshot sources -------------------------------------------------
//
// Two previously-ignored notifications now feed the `getStatus` snapshot
// (they don't map to feed events of their own — the adapter caches the
// latest values and answers a `control: getStatus` with ONE `status_snapshot`
// event; see adapters/codex.ts):
//   - `thread/tokenUsage/updated` → session token totals + context window
//   - `thread/status/changed`     → running / idle

/** The name codex's tokenUsage notification arrives under.
 * ASSUMPTION (unverified, no `codex` binary — method name per the plan §1/§2
 * research against https://developers.openai.com/codex/app-server): the
 * params carry a `tokenUsage` object. */
/** Maps one parsed line of `codex app-server`'s stdout (JSON-RPC notifications). */
export function normalizeCodex(raw: unknown): NormalizedEvent[] {
	if (!isRecord(raw) || typeof raw.method !== "string") {
		return NO_EVENTS;
	}
	const params = raw.params;
	if (!isRecord(params)) {
		return NO_EVENTS;
	}
	const handler = CODEX_NOTIFICATION_HANDLERS[raw.method];
	return handler ? handler(params) : NO_EVENTS;
}

/** R1-T2: stateful wrapper around `normalizeCodex` that additionally stamps
 * `durationMs` onto `commandExecution`/`mcpToolCall`/`dynamicToolCall` tool
 * events — codex's wire never reports how long a tool ran, only a
 * started/completed pair keyed by item id (see tool-timing.ts). One instance
 * lives per session, in adapters/codex.ts's `start`. */
export function createCodexNormalizer(): (raw: unknown) => NormalizedEvent[] {
	const tracker = createToolDurationTracker();
	return (raw: unknown): NormalizedEvent[] =>
		normalizeCodex(raw).map((event) => withToolDuration(tracker, event));
}

// Approval *requests* (as opposed to the notifications this file maps) live
// in codex-approvals.ts, split out to keep this file under the 300-line cap.
export { normalizeCodexApprovalRequest } from "./codex-approvals";
