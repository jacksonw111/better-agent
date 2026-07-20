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
	/** S3-T2: set by the CLI on the Task Start Context it injects as the run's
	 * first user input (see apps/bridge-cli/src/task-launch/run-session.ts) —
	 * the web folds these turns collapsed instead of as ordinary user bubbles. */
	origin?: "task-start";
	role: "user" | "assistant";
	/** fix-send-outbox: LOCAL-ONLY (never on the wire, never parsed off a
	 * server frame) — the send-outbox key of the optimistic echo this event is,
	 * so the outbox's status updates can find their line again. Only ever set
	 * on a negative-id echo (see use-bridge-feed.ts's `localEcho`). */
	sendKey?: string;
	/** fix-send-outbox: LOCAL-ONLY — the echo's live delivery state. Absent
	 * once the send succeeded (it is then an ordinary user message, awaiting
	 * its persisted twin); `"failed"` after the outbox exhausted its retries,
	 * which the row renders with retry/discard actions. */
	sendStatus?: "failed" | "sending" | "sent";
	text: string;
	thinking?: boolean;
}

/** A tool invocation, from request through to its result. */
export interface ToolEvent extends TurnScoped {
	/** R1-T2: wall-clock ms between the `started` and `completed`/`failed`
	 * events for this id, when the CLI adapter could measure it. Additive —
	 * mirrors `apps/bridge-cli/src/normalize/types.ts`; no fold/render wiring
	 * here yet (owned by a parallel task). */
	durationMs?: number;
	id: string;
	input?: unknown;
	kind: "tool";
	name: string;
	output?: unknown;
	/** R1-T2: a RUNNING tool's latest partial output — REPLACE semantics, not
	 * append. Additive — no fold/render wiring here yet (owned by a parallel
	 * task). */
	preview?: string;
	/** P4-T2: mirrors the CLI's `ToolEvent.source` — set to "runShell" on the
	 * out-of-band Shell tab's tool events, which the Shell pane renders and
	 * `bridge-turns.ts` filters OUT of the chat feed. Absent on ordinary
	 * agent-emitted tool events. */
	source?: "runShell";
	status: "started" | "completed" | "failed";
	/** R1-T2: a short human-readable label for the tool call, when the wire
	 * carries one distinct from `name`. Additive — no fold/render wiring here
	 * yet (owned by a parallel task). */
	title?: string;
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
	/** fix-approval-replay: set on the RESOLUTION event the CLI pushes (and
	 * persists) the moment the user's answer resolves `requestId` — mirrors
	 * the CLI's `ApprovalEvent.answeredOptionId`
	 * (`apps/bridge-cli/src/adapters/approvals.ts`). The feed folds it into
	 * the answered map (use-bridge-feed.ts) so a reload/replay renders the
	 * original card as answered; the turns fold never renders it as a card of
	 * its own (bridge-turns-approval.ts). */
	answeredOptionId?: string;
	/** RC-T3: set when this event retracts a still-open approval card (the
	 * adapter interrupted/stopped the turn before the user answered) instead
	 * of requesting a fresh decision — see `bridge-turns.ts`'s fold. */
	cancelled?: boolean;
	detail?: string;
	kind: "approval";
	options: ApprovalOption[];
	requestId: string;
	/** R3-T2: a human-readable change summary ("3 files: 2 added, 1
	 * modified…") — mirrors the CLI's `ApprovalEvent.summary`
	 * (`apps/bridge-cli/src/normalize/types.ts`). Additive; currently only
	 * codex's fileChange approval requests populate it. */
	summary?: string;
	/** R3-T2: epoch ms the CLI's `presentApproval` will resolve this card
	 * declined if nobody answers — mirrors the CLI's
	 * `ApprovalEvent.timeoutAt`. Additive; drives `ApprovalLine`'s countdown
	 * bar. */
	timeoutAt?: number;
	/** R3-4 review finding 4: the total window (ms) `timeoutAt` was computed
	 * from — mirrors the CLI's `ApprovalEvent.timeoutMs`. Additive; lets
	 * `ApprovalCountdown` initialize its bar from the correct remaining
	 * fraction on mount instead of always starting at 100% (e.g. a page
	 * remount mid-window). */
	timeoutMs?: number;
	title: string;
}

/** One question within a `QuestionEvent` — mirrors the CLI's `QuestionItem`
 * (`apps/bridge-cli/src/normalize/types.ts`). */
export interface QuestionItem {
	options: string[];
	text: string;
}

/**
 * R3-T3: opencode's `question.asked` — a SEPARATE request family from
 * `ApprovalEvent`/`permission.updated` (a question asks for information, an
 * approval asks for permission to act), but round-trips through
 * `onAnswerQuestion` the same shape-of-way `ApprovalEvent` does through
 * `onAnswerApproval`. Mirrors the CLI's `QuestionEvent`.
 */
export interface QuestionEvent extends TurnScoped {
	/** fix-question-replay: set on the RESOLUTION event the CLI pushes (and
	 * persists) the moment the user's answer resolves `requestId` — mirrors
	 * the CLI's `QuestionEvent.answeredAnswers`
	 * (`apps/bridge-cli/src/adapters/questions.ts`). The feed folds it into
	 * the answeredQuestions map (use-bridge-feed.ts) so a reload/replay
	 * renders the original card as answered; the turns fold never renders it
	 * as a card of its own (bridge-turns-approval.ts). */
	answeredAnswers?: string[][];
	/** Mirrors `ApprovalEvent.cancelled` — set when a still-pending question is
	 * retracted (interrupt/stop, or the CLI's fail-closed timeout) instead of
	 * requesting a fresh answer. */
	cancelled?: boolean;
	kind: "question";
	questions: QuestionItem[];
	requestId: string;
	/** Mirrors `ApprovalEvent.timeoutAt` — the epoch ms the CLI's
	 * `presentQuestion` armed its fail-closed timer for. */
	timeoutAt?: number;
	/** Mirrors `ApprovalEvent.timeoutMs` (R3-4 review finding 4). */
	timeoutMs?: number;
	title: string;
}

export type NormalizedEvent =
	| MessageEvent
	| ToolEvent
	| FileEvent
	| OutputEvent
	| StatusEvent
	| ErrorEvent
	| ApprovalEvent
	| QuestionEvent;

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
	"question",
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
