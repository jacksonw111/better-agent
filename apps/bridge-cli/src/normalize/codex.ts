// codex: `codex app-server` — a long-lived JSON-RPC 2.0 process over stdio
// (the "jsonrpc" version field is omitted on the wire). We drive it with
// `thread/start` + `turn/start` requests and map the `item/*` and `turn/*`
// notifications streamed back during a turn. See
// https://developers.openai.com/codex/app-server for the protocol reference.

import {
	type ApprovalEvent,
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

// Streaming deltas (`item/agentMessage/delta`) and the final message
// (`item.completed`) both carry the item's id — see `normalizeCodexAgentMessageDelta`
// below — so the web can merge them into ONE bubble instead of rendering the
// item's text twice (the reported "codex repeats every output" bug).
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

function normalizeCodexItem(item: unknown): NormalizedEvent[] {
	if (!isRecord(item) || typeof item.type !== "string") {
		return NO_EVENTS;
	}
	switch (item.type) {
		case "agentMessage":
			return normalizeCodexAgentMessageItem(item);
		case "commandExecution":
			return normalizeCodexCommandExecutionItem(item);
		case "fileChange":
			return normalizeCodexFileChangeItem(item);
		default:
			return NO_EVENTS;
	}
}

function normalizeCodexAgentMessageDelta(
	params: Record<string, unknown>
): NormalizedEvent[] {
	const text = asString(params.delta);
	if (text === undefined) {
		return NO_EVENTS;
	}
	return [
		{ id: asString(params.itemId), kind: "output", text },
		...turnAbortedEvents(text),
	];
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
	"item/started": (params) => normalizeCodexItem(params.item),
	"item/completed": (params) => normalizeCodexItem(params.item),
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

// --- Approval requests ------------------------------------------------------
//
// ASSUMPTION (unverified — no `codex` binary is available in this sandbox;
// method names per https://developers.openai.com/codex/app-server, which
// documents the approval workflow and the client's decision vocabulary but
// not the literal JSON-RPC envelope for the *request* side): the app-server
// asks for approval via a server-initiated *request* — an id-bearing
// message, handled by `jsonrpc-io.ts`'s `onRequest`, not a notification —
// named `item/commandExecution/requestApproval` or
// `item/fileChange/requestApproval`. We reply with a simplified two-option
// decision, `{ decision: "accept" | "decline" }`, collapsing the documented
// `acceptForSession`/`cancel`/`acceptWithExecpolicyAmendment` variants (no UI
// for those yet). Reverify against the installed codex version — both the
// method names and the reply envelope — before relying on this.

const CODEX_APPROVAL_METHODS = new Set([
	"item/commandExecution/requestApproval",
	"item/fileChange/requestApproval",
]);

/** The only two decisions `answerApproval` can currently produce for codex;
 * see the ASSUMPTION above about the decisions this collapses away. */
const CODEX_APPROVAL_OPTIONS = [
	{ id: "accept", label: "Allow" },
	{ id: "decline", label: "Deny" },
];

function codexApprovalTitle(method: string): string {
	return method === "item/fileChange/requestApproval"
		? "Apply file change?"
		: "Run command?";
}

function codexApprovalDetail(
	params: Record<string, unknown>
): string | undefined {
	const command = isArrayOf(
		params.command,
		(part): part is string => typeof part === "string"
	)
		? params.command.join(" ")
		: asString(params.command);
	return command ?? asString(params.reason);
}

/**
 * Maps a codex app-server server-initiated approval *request* — an
 * `onRequest`-surfaced `(id, method, params)`, not an `onNotification` one —
 * to an `ApprovalEvent`, or `[]` if `method` isn't a known approval method.
 */
export function normalizeCodexApprovalRequest(
	requestId: string,
	method: string,
	params: unknown
): ApprovalEvent[] {
	if (!CODEX_APPROVAL_METHODS.has(method)) {
		return [];
	}
	return [
		{
			detail: isRecord(params) ? codexApprovalDetail(params) : undefined,
			kind: "approval",
			options: CODEX_APPROVAL_OPTIONS,
			requestId,
			title: codexApprovalTitle(method),
		},
	];
}
