// claude-code: `claude -p --output-format stream-json --input-format stream-json --verbose`.
// See https://code.claude.com/docs/en/headless for the documented envelope
// shapes (system/init, system/api_retry, assistant, user, result,
// stream_event). Confirm against the installed `claude` version if its
// stream-json output ever changes shape.

import { createToolDurationTracker, withToolDuration } from "./tool-timing";
import { asString, isRecord, NO_EVENTS, type NormalizedEvent } from "./types";

function normalizeTextBlock(
	role: "user" | "assistant",
	block: Record<string, unknown>
): NormalizedEvent[] {
	const text = asString(block.text);
	return text === undefined ? NO_EVENTS : [{ kind: "message", role, text }];
}

function normalizeThinkingBlock(
	role: "user" | "assistant",
	block: Record<string, unknown>
): NormalizedEvent[] {
	const text = asString(block.thinking);
	// Drop empty/whitespace-only reasoning — an empty "thinking" bubble is worse
	// than none (the SDK emits a placeholder thinking block before content).
	return text && text.trim() !== ""
		? [{ kind: "message", role, text, thinking: true }]
		: NO_EVENTS;
}

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

function normalizeClaudeContentBlock(
	role: "user" | "assistant",
	block: unknown
): NormalizedEvent[] {
	if (!isRecord(block) || typeof block.type !== "string") {
		return NO_EVENTS;
	}
	switch (block.type) {
		case "text":
			// Assistant response text AND reasoning both stream live via
			// `stream_event` (`text_delta` / `thinking_delta`) — see
			// normalizeClaudeStreamEvent. The final assistant message repeats
			// both as `text`/`thinking` blocks, so drop them here to avoid
			// double-rendering (reasoning would otherwise show twice + a spurious
			// bubble). User-role messages (tool_result echoes) are unaffected.
			return role === "assistant" ? NO_EVENTS : normalizeTextBlock(role, block);
		case "thinking":
			return role === "assistant"
				? NO_EVENTS
				: normalizeThinkingBlock(role, block);
		case "tool_use":
			return normalizeToolUseBlock(block);
		case "tool_result":
			return normalizeToolResultBlock(block);
		default:
			return NO_EVENTS;
	}
}

function normalizeClaudeMessage(
	raw: Record<string, unknown>,
	role: "user" | "assistant"
): NormalizedEvent[] {
	const message = raw.message;
	if (typeof message === "string") {
		return [{ kind: "message", role, text: message }];
	}
	if (!isRecord(message)) {
		return NO_EVENTS;
	}
	const content = message.content;
	if (typeof content === "string") {
		return [{ kind: "message", role, text: content }];
	}
	if (!Array.isArray(content)) {
		return NO_EVENTS;
	}
	return content.flatMap((block) => normalizeClaudeContentBlock(role, block));
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

function normalizeClaudeSystem(
	raw: Record<string, unknown>
): NormalizedEvent[] {
	if (asString(raw.subtype) === "init") {
		return [
			{ kind: "status", status: "session_ready", detail: sessionInfo(raw) },
		];
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
