import type { ToolInvocation } from "@better-agent/ui/components/chat/chat-blocks";
import { isTaskToolInput } from "@/genui/tool-renderers";
import {
	accumulateOutput,
	createFoldState,
	type FoldState,
	finalizeAssistantMessage,
	openAssistant,
	pushTurn,
} from "./bridge-assistant-merge";
import { COMMAND_CATALOG_STATUS } from "./bridge-command-catalog";
import type {
	MessageEvent,
	NormalizedEvent,
	StatusEvent,
	StreamEvent,
	ToolEvent,
} from "./bridge-events";
import { SESSION_LIST_STATUS } from "./bridge-session-list";
import {
	PLAN_STATUS,
	SESSION_READY_STATUS,
	TURN_USAGE_STATUS,
	USAGE_UPDATE_STATUS,
} from "./bridge-session-status";
import { STATUS_SNAPSHOT_STATUS } from "./bridge-status-snapshot";
import type { BridgeTurn, PlanTurn, TaskTurn } from "./bridge-turn-types";
import { foldApproval, foldQuestion } from "./bridge-turns-approval";
import {
	applyToolResult,
	createTaskInvocation,
	recordSubagentActivity,
	updateTaskInvocation,
} from "./bridge-turns-tool-task";
import { STATUS_NOTICE_KINDS } from "./status-line";
import { parseTodoItems } from "./todo-list";

export type {
	AssistantTurn,
	BridgeTurn,
	TaskTurn,
	UserTurn,
} from "./bridge-turn-types";

/** Status events hidden from the chat feed: curated metadata statuses (session
 * capabilities, cost/tokens, past-conversations — surfaced by dedicated header/
 * chip UI) AND pure lifecycle heartbeats (pi's agent_start/turn_start, codex's
 * turn_started, opencode's usage_update) that carry nothing worth reading inline.
 * All still act as a turn boundary (closing any open assistant accumulation),
 * except where noted below. */
const HIDDEN_STATUS_KINDS = new Set<string>([
	SESSION_READY_STATUS,
	TURN_USAGE_STATUS,
	SESSION_LIST_STATUS,
	USAGE_UPDATE_STATUS,
	// R5-T1: each adapter's slash-command catalog — curated metadata like the
	// others above (R5-T2 renders it via dedicated UI, not the chat feed).
	COMMAND_CATALOG_STATUS,
	// Task 13 addendum: the on-demand `{ control: getStatus }` reply, consumed
	// straight off the raw event stream by `use-bridge-feed.ts`'s own reducer
	// (feeding `status-snapshot-panel.tsx`) BEFORE this fold ever runs — same
	// shape as SESSION_READY_STATUS/TURN_USAGE_STATUS above, not a lifecycle
	// boundary, so it does NOT appear in TURN_BOUNDARY_STATUS_KINDS either.
	STATUS_SNAPSHOT_STATUS,
	"agent_start",
	"agent_end",
	"turn_start",
	"turn_end",
	"turn_started",
	"turn_completed",
	// R2-T3 review finding 1: pi's TRUE end-of-turn signal (agent_end can be
	// followed by auto-retries — see bridge-cli's normalize/pi.ts) — a pure
	// lifecycle heartbeat like the others above, not worth reading inline.
	"agent_settled",
	"queue_update",
	"compaction_start",
	"compaction_end",
	"auto_retry_start",
	"auto_retry_end",
]);

/** Hidden statuses that mark a genuine turn boundary (lifecycle start/end) —
 * the only hidden ones that close an in-flight assistant bubble (see
 * `foldStatus`); the rest are mid-stream metric heartbeats. */
const TURN_BOUNDARY_STATUS_KINDS = new Set<string>([
	"agent_start",
	"agent_end",
	"turn_start",
	"turn_end",
	"turn_started",
	"turn_completed",
	// pi's true turn boundary (see HIDDEN_STATUS_KINDS above).
	"agent_settled",
]);

/** Folds a `plan` status update into the ONE plan turn: creates it on the first
 * update (at its natural position), then replaces its items in place on later
 * updates so the checklist fills in rather than stacking copies. An empty/
 * unparseable payload is ignored. */
function foldPlan(state: FoldState, id: number, event: StatusEvent): void {
	const items = parseTodoItems(event.detail);
	if (items.length === 0) {
		return;
	}
	if (state.plan) {
		state.plan.items = items;
		state.touched.add(state.plan);
		return;
	}
	const turn: PlanTurn = { kind: "plan", id, items };
	state.plan = turn;
	pushTurn(state, turn);
}

/** A task call never joins the assistant's block flow — it closes any open
 * assistant accumulation and renders as its own turn, mirroring how a file
 * or status event is folded, so its card can show every status (a plain
 * `ToolGroup` rich-render only ever shows once a call is complete). */
function foldTaskTool(state: FoldState, id: number, event: ToolEvent): void {
	state.current = null;
	const existing = state.tasksByCallId.get(event.id);
	if (existing) {
		updateTaskInvocation(existing.task, event);
		state.touched.add(existing);
		return;
	}
	const task = createTaskInvocation(event);
	updateTaskInvocation(task, event);
	const turn: TaskTurn = { kind: "task", id, task };
	state.tasksByCallId.set(event.id, turn);
	pushTurn(state, turn);
}

/** A message is a turn boundary: it closes any open output accumulation. A
 * user message always starts its own turn; an assistant message merges by id
 * with its in-flight streamed bubble (or opens a fresh one) — see
 * `finalizeAssistantMessage` in bridge-assistant-merge.ts for the id contract
 * that fixes codex's double-rendered output. */
function foldMessage(state: FoldState, id: number, event: MessageEvent): void {
	if (event.role === "user") {
		state.current = null;
		pushTurn(state, { kind: "user", id, text: event.text });
		return;
	}
	finalizeAssistantMessage(state, id, event);
}

function foldTool(state: FoldState, id: number, event: ToolEvent): void {
	// A completed/failed follow-up for an already-started task never carries
	// `input` again, so a call already known to be a task is routed there
	// unconditionally — only a brand-new call needs the input-shape check.
	if (state.tasksByCallId.has(event.id)) {
		foldTaskTool(state, id, event);
		return;
	}
	// A later update (completed/failed) mutates the block created at `started`
	// in place — even if a boundary has since closed that assistant turn — so
	// it never spawns a spurious empty bubble.
	const existing = state.toolsByCallId.get(event.id);
	if (existing) {
		applyToolResult(existing.tool, event);
		state.touched.add(existing.turn);
		// P1-T3: mirror the settle into the running task's tool history too
		// (only ever updates a run this task already started — see
		// recordSubagentActivity).
		recordSubagentActivity(state, event);
		return;
	}
	// A subagent "Task" tool: identified by input shape (subagent_type, or
	// description+prompt) OR by claude's fixed tool name "Task" — the name
	// fallback catches calls whose args arrive late, folding into a TaskCard.
	// (Checked BEFORE recordSubagentActivity so a second, parallel task is
	// never recorded as a tool run of the first.)
	if (event.name === "Task" || isTaskToolInput(event.input)) {
		foldTaskTool(state, id, event);
		return;
	}
	// P1-T3: a plain tool starting while a (sole) task runs is presumed to be
	// that subagent's own execution — mirrored into the task's history.
	recordSubagentActivity(state, event);
	const turn = openAssistant(state, id);
	const tool: ToolInvocation = {
		callId: event.id,
		toolName: event.name,
		args: event.input,
		isError: false,
		status: "running",
	};
	applyToolResult(tool, event);
	turn.blocks.push({ kind: "tool", tool });
	state.toolsByCallId.set(event.id, { tool, turn });
}

/**
 * Folds a `status` event. It closes the in-flight assistant bubble ONLY for a
 * genuine turn boundary or a DISPLAYED status line — never a hidden mid-stream
 * heartbeat (`usage_update`/`queue_update`/…, which opencode emits between an
 * assistant's own output deltas). Nulling `current` on those fragmented one
 * reply into a bubble per heartbeat — the "sentence-by-sentence" bug.
 *
 * Whitelist semantics on the fallthrough: a status must be EXPLICITLY known
 * (`STATUS_NOTICE_KINDS` — the CLI's own curated lifecycle notices — or
 * `HIDDEN_STATUS_KINDS` above) to touch `state.current`/render a turn at all.
 * Anything else — an unrecognized `sessionUpdate` kind from opencode's ACP
 * normalizer, or any future adapter chatter this codebase hasn't been taught
 * about yet — is silently absorbed: no status turn, no boundary. Adapters can
 * add new status kinds at any time (see `normalize/opencode.ts`'s default
 * case); rendering must always be opt-in via one of the two curated lists,
 * never opt-out, or a single unrecognized kind fragments the whole reply.
 */
function foldStatus(state: FoldState, id: number, event: StatusEvent): void {
	if (event.status === PLAN_STATUS) {
		state.current = null;
		foldPlan(state, id, event);
		return;
	}
	if (HIDDEN_STATUS_KINDS.has(event.status)) {
		if (TURN_BOUNDARY_STATUS_KINDS.has(event.status)) {
			state.current = null;
		}
		return;
	}
	if (STATUS_NOTICE_KINDS.has(event.status)) {
		state.current = null;
		pushTurn(state, { kind: "status", id, event });
		return;
	}
	// Unknown status kind: never fragment the bubble, never render.
}

/** Folds ONE event into `state`, mutating it in place — the shared per-event
 * core both `foldEventsToTurns` (one-shot batch) and the incremental fold
 * engine (fold-cursor.ts) call, so the two can never diverge in behavior. */
export function foldEvent(
	state: FoldState,
	id: number,
	event: NormalizedEvent
): void {
	switch (event.kind) {
		case "message":
			foldMessage(state, id, event);
			return;
		case "output":
			accumulateOutput(state, id, event);
			return;
		case "tool":
			foldTool(state, id, event);
			return;
		case "status":
			foldStatus(state, id, event);
			return;
		case "error":
			state.current = null;
			pushTurn(state, { kind: "error", id, event });
			return;
		case "file":
			state.current = null;
			pushTurn(state, { kind: "file", id, event });
			return;
		case "approval":
			foldApproval(state, id, event);
			return;
		default:
			foldQuestion(state, id, event);
	}
}

// foldApproval/foldQuestion moved to bridge-turns-approval.ts (see its
// header comment for why).

/**
 * Folds the ordered, already-deduped bridge feed into renderable turns. Pure
 * and deterministic: only the trailing still-open assistant turn is marked
 * `streaming`, so a completed turn never keeps a caret.
 */
export function foldEventsToTurns(events: StreamEvent[]): BridgeTurn[] {
	const state = createFoldState();
	for (const { id, event } of events) {
		foldEvent(state, id, event);
	}
	if (state.current) {
		state.current.streaming = true;
	}
	return state.turns;
}
