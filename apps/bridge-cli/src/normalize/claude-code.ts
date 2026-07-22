// claude-code: `claude -p --output-format stream-json --input-format stream-json --verbose`.
// See https://code.claude.com/docs/en/headless for the documented envelope
// shapes (system/init, system/api_retry, assistant, user, result,
// stream_event). Confirm against the installed `claude` version if its
// stream-json output ever changes shape.

import { createToolDurationTracker, withToolDuration } from "./tool-timing";
import { asString, isRecord, NO_EVENTS, type NormalizedEvent } from "./types";

function normalizeToolUseBlock(
	block: Record<string, unknown>
): NormalizedEvent[] {
	const id = asString(block.id);
	const name = asString(block.name);
	return id === undefined || name === undefined
		? NO_EVENTS
		: [{ kind: "tool", id, name, status: "started", input: block.input }];
}

function normalizeToolResultBlock(
	block: Record<string, unknown>
): NormalizedEvent[] {
	const id = asString(block.tool_use_id);
	if (id === undefined) {
		return NO_EVENTS;
	}
	return [
		{
			kind: "tool",
			id,
			name: id,
			status: block.is_error ? "failed" : "completed",
			output: block.content,
		},
	];
}

function normalizeClaudeContentBlock(block: unknown): NormalizedEvent[] {
	if (!isRecord(block) || typeof block.type !== "string") {
		return NO_EVENTS;
	}
	switch (block.type) {
		case "tool_use":
			return normalizeToolUseBlock(block);
		case "tool_result":
			return normalizeToolResultBlock(block);
		// `text` / `thinking` blocks never render here. On an ASSISTANT frame the
		// response text and reasoning already stream live via `stream_event`
		// (`text_delta` / `thinking_delta`, see normalizeClaudeStreamEvent) and
		// repeat as `text`/`thinking` blocks on the final message — rendering them
		// again would double up (reasoning twice + a spurious bubble). On a `user`
		// frame they are SDK-injected subagent/echo internals, never the human's
		// input (see normalizeClaudeMessage). Only tool_use/tool_result blocks
		// carry renderable state.
		default:
			return NO_EVENTS;
	}
}

// A `type:"user"` frame is NEVER the human's live input. The human's own turn
// is pushed separately as a `userMessageEvent` from the adapter's `send()`
// (see adapters/claude-code.ts `doSend`), so it never travels this normalize
// path. Every `type:"user"` frame the SDK emits is injected content: a
// subagent's task prompt echoed as its first user turn (a byte-for-byte
// duplicate of the Task/Agent `tool_use` input — `parent_tool_use_id` set), and
// tool_result echoes. Rendering a user frame's text/string body as a
// `role:"user"` chat bubble mislabels those internals as messages the human
// typed — the reported bug, confirmed against real stream-json. So a user frame
// must yield only tool events (from its tool_result blocks), never a message.
function normalizeClaudeMessage(
	raw: Record<string, unknown>,
	role: "user" | "assistant"
): NormalizedEvent[] {
	const message = raw.message;
	if (typeof message === "string") {
		return role === "assistant"
			? [{ kind: "message", role, text: message }]
			: NO_EVENTS;
	}
	if (!isRecord(message)) {
		return NO_EVENTS;
	}
	const content = message.content;
	if (typeof content === "string") {
		return role === "assistant"
			? [{ kind: "message", role, text: content }]
			: NO_EVENTS;
	}
	if (!Array.isArray(content)) {
		return NO_EVENTS;
	}
	return content.flatMap((block) => normalizeClaudeContentBlock(block));
}

// Curated session metadata pulled off the init line — the model, resumable
// session id, and the capabilities a "Claude Code online" UI surfaces (tools,
// slash commands, skills, MCP servers, permission mode). The raw init line
// (and every other system line: hooks, thinking-token counters, stream_event
// bookkeeping) is internal noise the user shouldn't see in the chat.
function sessionInfo(raw: Record<string, unknown>): Record<string, unknown> {
	return {
		sessionId: asString(raw.session_id),
		model: asString(raw.model),
		cwd: asString(raw.cwd),
		permissionMode: asString(raw.permissionMode),
		tools: raw.tools,
		slashCommands: raw.slash_commands,
		skills: raw.skills,
		mcpServers: raw.mcp_servers,
	};
}

// R5-T1: the SDK's mid-session slash-command push (fires when skills are
// discovered dynamically as the agent works in a subdirectory) — a
// REPLACEMENT payload per the SDK's own doc comment on
// `SDKCommandsChangedMessage` ("Clients should REPLACE their cached command
// list with this payload"), so this maps straight to a fresh `command_catalog`
// status event, same shape as the adapter's one-time initial fetch (see
// claude-code-commands.ts's `commandCatalogEvent`).
function commandsChangedEvent(raw: Record<string, unknown>): NormalizedEvent[] {
	if (!Array.isArray(raw.commands)) {
		return NO_EVENTS;
	}
	const commands = raw.commands
		.filter(isRecord)
		.map((command) => ({
			name: asString(command.name),
			description: asString(command.description),
		}))
		.filter(
			(command): command is { name: string; description: string | undefined } =>
				command.name !== undefined
		);
	return [{ kind: "status", status: "command_catalog", detail: { commands } }];
}

/** The SDK's `SDKStatusMessage` (system/status) optionally carries the LIVE
 * `permissionMode` — the only wire signal for a mid-session mode change the
 * adapter itself didn't make (plan-mode exit, the CLI's own mode cycling).
 * Surfaced as a curated `permission_mode_changed` status (folded into the
 * web's sessionReady detail — see the web's use-bridge-feed.ts); a status
 * line without one stays internal noise. */
function statusChangedEvent(raw: Record<string, unknown>): NormalizedEvent[] {
	const permissionMode = asString(raw.permissionMode);
	if (permissionMode === undefined) {
		return NO_EVENTS;
	}
	return [
		{
			kind: "status",
			status: "permission_mode_changed",
			detail: { permissionMode },
		},
	];
}

function normalizeClaudeSystem(
	raw: Record<string, unknown>
): NormalizedEvent[] {
	if (asString(raw.subtype) === "init") {
		return [
			{ kind: "status", status: "session_ready", detail: sessionInfo(raw) },
		];
	}
	if (asString(raw.subtype) === "commands_changed") {
		return commandsChangedEvent(raw);
	}
	if (asString(raw.subtype) === "status") {
		return statusChangedEvent(raw);
	}
	// Every other system subtype (hooks, thinking_tokens, …) is internal noise.
	return NO_EVENTS;
}

// The turn's cost/usage, curated from the result line for a usage footer.
function normalizeClaudeResult(
	raw: Record<string, unknown>
): NormalizedEvent[] {
	return [
		{
			kind: "status",
			status: "turn_usage",
			detail: {
				costUsd: raw.total_cost_usd,
				numTurns: raw.num_turns,
				durationMs: raw.duration_ms,
				usage: raw.usage,
				isError: raw.is_error === true,
				// claude's own session UUID — stable across the CLI's push-queue
				// retries (unlike the server-assigned relay seq), so the server
				// keys its usage dedup off this + numTurns instead. See
				// packages/api/src/routers/bridge-record-usage.ts.
				sessionId: asString(raw.session_id),
			},
		},
	];
}

function normalizeClaudeStreamEvent(
	raw: Record<string, unknown>
): NormalizedEvent[] {
	const event = raw.event;
	if (!isRecord(event)) {
		return NO_EVENTS;
	}
	const delta = event.delta;
	if (!isRecord(delta)) {
		return NO_EVENTS;
	}
	if (delta.type === "text_delta") {
		const text = asString(delta.text);
		return text === undefined ? NO_EVENTS : [{ kind: "output", text }];
	}
	if (delta.type === "thinking_delta") {
		const text = asString(delta.thinking);
		return text === undefined
			? NO_EVENTS
			: [{ kind: "output", reasoning: true, text }];
	}
	// Non-text/thinking stream_event frames are internal bookkeeping.
	return NO_EVENTS;
}

/** Maps one parsed line of `claude`'s stream-json stdout to normalized events. */
export function normalizeClaudeCode(raw: unknown): NormalizedEvent[] {
	if (!isRecord(raw)) {
		return NO_EVENTS;
	}
	switch (raw.type) {
		case "system":
			return normalizeClaudeSystem(raw);
		case "assistant":
			return normalizeClaudeMessage(raw, "assistant");
		case "user":
			return normalizeClaudeMessage(raw, "user");
		case "result":
			return normalizeClaudeResult(raw);
		case "stream_event":
			return normalizeClaudeStreamEvent(raw);
		default:
			return NO_EVENTS;
	}
}

/**
 * R1-T2: the claude-code SDK's stream-json output carries no tool duration on
 * the wire — `tool_use` (start) and `tool_result` (end) share the same id
 * namespace (`block.id` / `block.tool_use_id`), so it's trivially wireable
 * adapter-side with the same `withToolDuration` tracker codex/pi use. One
 * instance per session, so state doesn't leak across sessions.
 */
export function createClaudeCodeNormalizer(): (
	raw: unknown
) => NormalizedEvent[] {
	const tracker = createToolDurationTracker();
	return (raw: unknown): NormalizedEvent[] =>
		normalizeClaudeCode(raw).map((event) => withToolDuration(tracker, event));
}
