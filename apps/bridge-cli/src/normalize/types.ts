// The normalized event model every adapter maps its agent's raw NDJSON onto.
// `kind` discriminates the payload shape; downstream consumers (relay-client,
// the server, the web UI) only ever need to understand these seven shapes,
// never any agent-specific protocol.

/** RC-T3 (docs/remote-control-redesign-plan.md, Pillar 3): the monotonic
 * per-session turn counter an adapter stamps onto every event it pushes —
 * see `apps/bridge-cli/src/adapters/turn-epoch.ts`. Optional/additive so
 * every existing event shape stays backward compatible; absent on an event
 * an adapter hasn't been wired for epoch stamping yet. `relay-client.ts`'s
 * `forwardEvents` drops any event whose `turnEpoch` is lower than the
 * highest one already forwarded — the straggler-drop that keeps an aborted
 * turn's late output from rendering into the next turn. */
interface TurnScoped {
	turnEpoch?: number;
}

/** A single chat turn from either the user or the assistant. */
export interface MessageEvent extends TurnScoped {
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
export interface ToolEvent extends TurnScoped {
	/** R1-T2: wall-clock ms between the `started` and `completed`/`failed`
	 * events for this id, when the adapter could measure it (adapter-side
	 * timing for protocols whose wire never reports a duration itself — see
	 * `tool-timing.ts` — or wire-native for opencode-serve's `state.time`).
	 * Absent where neither applies (e.g. claude-code with no matching start). */
	durationMs?: number;
	id: string;
	input?: unknown;
	kind: "tool";
	name: string;
	output?: unknown;
	/** R1-T2: a RUNNING tool's latest partial output — REPLACE semantics, not
	 * append (each event carries the tool's full output so far, not a delta).
	 * Currently only pi's `tool_execution_update` populates this, on a
	 * `status: "started"` event. */
	preview?: string;
	/** P4-T2: marks a tool event as the out-of-band `runShell` channel's output
	 * (see `apps/bridge-cli/src/shell-runner.ts`) rather than one of the agent's
	 * own tool calls — the web routes these to its Shell tab AND filters them out
	 * of the chat feed. Absent on every ordinary adapter-emitted tool event. */
	source?: "runShell";
	status: "started" | "completed" | "failed";
	/** R1-T2: a short human-readable label for the tool call, when the wire
	 * carries one distinct from `name` (opencode-serve's `state.title`, e.g.
	 * "Read src/app.ts" for a `read` tool). */
	title?: string;
}

/** A file created/modified/deleted by the agent. */
export interface FileEvent extends TurnScoped {
	change: "created" | "modified" | "deleted";
	diff?: string;
	kind: "file";
	path: string;
}

/** Raw process output that doesn't fit the other kinds (e.g. shell output). */
export interface OutputEvent extends TurnScoped {
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
 * proceed. `requestId` round-trips through `AgentHandle.answerApproval` —
 * see `apps/bridge-cli/src/adapters/types.ts`.
 */
export interface ApprovalEvent extends TurnScoped {
	/** RC-T3: set (instead of a fresh approval request) when `interrupt()`/
	 * `stop()` retracts a still-pending approval — the web removes the open
	 * card for `requestId` instead of rendering a new one. `options`/`title`
	 * are still populated (a fixed placeholder) purely to satisfy the shape;
	 * the web never reads them for a cancelled card. */
	cancelled?: boolean;
	detail?: string;
	kind: "approval";
	options: ApprovalOption[];
	requestId: string;
	/** R3-T2: a human-readable change summary ("3 files: 2 added, 1
	 * modified…"), attached when the adapter cached enough detail about the
	 * pending item to build one — currently only codex's fileChange approval
	 * requests (see `normalize/codex-file-change-cache.ts`). Additive/optional
	 * — absent for every other approval kind. */
	summary?: string;
	/** R3-T2: the epoch ms `adapters/approvals.ts`'s `presentApproval` armed
	 * its fail-closed timer for — the same instant this approval resolves
	 * declined if nobody answers. Additive; lets the web render a countdown
	 * toward the exact moment the CLI itself will time this card out. */
	timeoutAt?: number;
	/** R3-4 review finding 4: the total window (ms) `timeoutAt` was computed
	 * from — always `APPROVAL_TIMEOUT_MS` today, stamped alongside `timeoutAt`
	 * so a remounted `ApprovalCountdown` can initialize its bar from the
	 * correct remaining fraction instead of restarting at 100%. Additive;
	 * absent on an event pushed before this field existed. */
	timeoutMs?: number;
	title: string;
}

/** R3-T3: one question in a `question.asked` request — a free-text prompt the
 * user answers by picking from `options` (single-select; `answers` on the
 * reply carries the chosen label(s) per question, see `commands.ts`'s
 * `ControlAnswerQuestionCommand`). */
export interface QuestionItem {
	options: string[];
	text: string;
}

/**
 * R3-T3: opencode's `question.asked` SSE event — a SEPARATE request family
 * from `ApprovalEvent`/`permission.updated` (a question asks for information,
 * an approval asks for permission to act), but round-trips through
 * `AgentHandle.answerQuestion` the same shape-of-way `ApprovalEvent` does
 * through `answerApproval`.
 */
export interface QuestionEvent extends TurnScoped {
	/** Mirrors `ApprovalEvent.cancelled` — set when a still-pending question is
	 * retracted (interrupt/stop, or the shared fail-closed timeout) instead of
	 * requesting a fresh answer. */
	cancelled?: boolean;
	kind: "question";
	questions: QuestionItem[];
	requestId: string;
	/** Mirrors `ApprovalEvent.timeoutAt` — the epoch ms `adapters/questions.ts`'s
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
