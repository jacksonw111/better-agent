// Mirrors the normalized event union from `apps/bridge-cli/src/normalize/types.ts`.
// The CLI is a private standalone app (not a workspace package web can import),
// so the shape is duplicated here — only the seven `kind`s and the fields the
// terminal view actually renders, not the full agent-protocol surface.

/** RC-T3 (docs/remote-control-redesign-plan.md, Pillar 3): mirrors the CLI's
 * `TurnScoped` (`apps/bridge-cli/src/normalize/types.ts`) — the monotonic
 * per-session turn counter an adapter stamps onto every event it pushes.
 * Optional/additive; not currently read by the web beyond the cancelled-
 * approval retract in `bridge-turns.ts`. */
interface TurnScoped {
	turnEpoch?: number;
}

/** A single chat turn from either the user or the assistant. */
export interface MessageEvent extends TurnScoped {
	/** The stable id of the logical message this is the FINAL text for —
	 * shared with any `OutputEvent` deltas that streamed the same message. See
	 * `bridge-assistant-merge.ts`: a matching in-flight streamed bubble is
	 * replaced in place (last-write-wins) instead of a second bubble. */
	id?: string;
	kind: "message";
	role: "user" | "assistant";
	text: string;
	thinking?: boolean;
}

/** A tool invocation, from request through to its result. */
export interface ToolEvent extends TurnScoped {
	id: string;
	input?: unknown;
	kind: "tool";
	name: string;
	output?: unknown;
	status: "started" | "completed" | "failed";
}

/** A file created/modified/deleted by the agent. */
export interface FileEvent extends TurnScoped {
	change: "created" | "modified" | "deleted";
	diff?: string;
	kind: "file";
	path: string;
}

/** Raw process output that doesn't fit the other kinds. */
export interface OutputEvent extends TurnScoped {
	/** The stable id of the logical message this delta streams text into —
	 * shared with the eventual final `MessageEvent` for the same message. */
	id?: string;
	kind: "output";
	/** True for a `thinking_delta` chunk (extended-thinking text streaming in),
	 * as opposed to the assistant's ordinary response text. */
	reasoning?: boolean;
	stream?: "stdout" | "stderr";
	text: string;
}

/** Lifecycle/progress information (session init, turn start/end, retries…). */
export interface StatusEvent extends TurnScoped {
	detail?: unknown;
	kind: "status";
	status: string;
}

/** A recoverable-or-not error surfaced by the agent or its transport. */
export interface ErrorEvent extends TurnScoped {
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
 * proceed. `requestId` round-trips in a `{ type: "approval", requestId,
 * optionId }` decision command sent back via `sendInput` — see
 * `apps/bridge-cli/src/commands.ts`.
 */
export interface ApprovalEvent extends TurnScoped {
	/** RC-T3: set when this event retracts a still-open approval card (the
	 * adapter interrupted/stopped the turn before the user answered) instead
	 * of requesting a fresh decision — see `bridge-turns.ts`'s fold. */
	cancelled?: boolean;
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

/** One relayed event as it comes off the wire (SSE `data:`/`id:` pair, or a
 * row from `bridge.observe`) — `data` is `unknown` until validated. */
export interface RawBridgeEvent {
	data: unknown;
	id: number;
}

/** A relayed event once its `data` has been validated into a NormalizedEvent. */
export interface StreamEvent {
	event: NormalizedEvent;
	id: number;
}

const EVENT_KINDS = new Set([
	"message",
	"tool",
	"file",
	"output",
	"status",
	"error",
	"approval",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Validates that `data` is at least shaped like a NormalizedEvent (a known
 * `kind`). Returns `null` for anything else so a malformed frame is dropped
 * instead of crashing the terminal's kind-switch render.
 */
export function parseNormalizedEvent(data: unknown): NormalizedEvent | null {
	if (!isRecord(data) || typeof data.kind !== "string") {
		return null;
	}
	return EVENT_KINDS.has(data.kind)
		? (data as unknown as NormalizedEvent)
		: null;
}
