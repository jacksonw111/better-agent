// The normalized event model every adapter maps its agent's raw NDJSON onto.
// `kind` discriminates the payload shape; downstream consumers (relay-client,
// the server, the web UI) only ever need to understand these seven shapes,
// never any agent-specific protocol.

/** A single chat turn from either the user or the assistant. */
export interface MessageEvent {
	/** The stable id of the logical message this is the FINAL text for —
	 * shared with any `OutputEvent` deltas that streamed the same message (see
	 * `OutputEvent.id`). The web merges by this id: a matching in-flight
	 * streamed bubble is replaced in place (last-write-wins) instead of a
	 * second bubble being rendered. Omitted by adapters that never stream a
	 * duplicate of their own final message (claude-code, pi). */
	id?: string;
	kind: "message";
	role: "user" | "assistant";
	text: string;
	thinking?: boolean;
}

/** A tool invocation, from request through to its result. */
export interface ToolEvent {
	id: string;
	input?: unknown;
	kind: "tool";
	name: string;
	output?: unknown;
	status: "started" | "completed" | "failed";
}

/** A file created/modified/deleted by the agent. */
export interface FileEvent {
	change: "created" | "modified" | "deleted";
	diff?: string;
	kind: "file";
	path: string;
}

/** Raw process output that doesn't fit the other kinds (e.g. shell output). */
export interface OutputEvent {
	/** The stable id of the logical message this delta streams text INTO —
	 * shared with the eventual final `MessageEvent` for the same message (see
	 * `MessageEvent.id`). Two chunks with the same id accumulate into one
	 * block; the web keeps ONE bubble per id rather than a new one per delta
	 * plus a duplicate for the final. Omitted where there's no correlating id
	 * (or no final message follows at all — claude-code/pi/opencode ACP only
	 * ever stream deltas for a given piece of text, never repeat it). */
	id?: string;
	kind: "output";
	/** True for a `thinking_delta` chunk (extended-thinking text streaming in),
	 * as opposed to the assistant's ordinary response text. */
	reasoning?: boolean;
	stream?: "stdout" | "stderr";
	text: string;
}

/** Lifecycle/progress information (session init, turn start/end, retries…). */
export interface StatusEvent {
	detail?: unknown;
	kind: "status";
	status: string;
}

/** A recoverable-or-not error surfaced by the agent or its transport. */
export interface ErrorEvent {
	detail?: unknown;
	kind: "error";
	message: string;
}

/** One option the user can pick to answer an `ApprovalEvent`. */
export interface ApprovalOption {
	id: string;
	label: string;
}

/**
 * A server-initiated request for the user to approve or deny an action
 * (run a command, apply a patch, use a tool) before the agent's turn can
 * proceed. `requestId` round-trips through `AgentHandle.answerApproval` —
 * see `apps/bridge-cli/src/adapters/types.ts`.
 */
export interface ApprovalEvent {
	detail?: string;
	kind: "approval";
	options: ApprovalOption[];
	requestId: string;
	title: string;
}

export type NormalizedEvent =
	| MessageEvent
	| ToolEvent
	| FileEvent
	| OutputEvent
	| StatusEvent
	| ErrorEvent
	| ApprovalEvent;

export const NO_EVENTS: NormalizedEvent[] = [];

/** The user's own turn, as an event on the events↑ stream. Adapters push this
 * from `send()` so the user's input is persisted (bridge_messages) and shows up
 * in history on reload — without it, only agent output survived a refresh. */
export function userMessageEvent(text: string): MessageEvent {
	return { kind: "message", role: "user", text };
}

export function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isArrayOf<T>(
	value: unknown,
	guard: (item: unknown) => item is T
): value is T[] {
	return Array.isArray(value) && value.every(guard);
}

export function asString(value: unknown): string | undefined {
	return typeof value === "string" ? value : undefined;
}
