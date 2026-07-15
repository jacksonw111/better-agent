// Split out of opencode-serve.ts purely to keep that file under the repo's
// 300-line file cap (R3-T3's questions plumbing pushed it over): the
// `send`/`setModel`/`setPermissionMode`/`interrupt` controls, the `getStatus`
// control, and the one-time `session_ready` push.

import type { OpencodeServeCommand } from "../normalize/opencode-serve-commands";
import { parseOpencodeServeStatus } from "../normalize/opencode-serve-status";
import { type NormalizedEvent, userMessageEvent } from "../normalize/types";
import { retractPendingApprovals } from "./approvals";
import type { AsyncQueue } from "./async-queue";
import { makeOpencodeSearchSessions } from "./opencode-search";
import type { ServeSessionContext } from "./opencode-serve";
import type { ServeAgentRef } from "./opencode-serve-agent";
import { firePost } from "./opencode-serve-http";
import { makeOpencodeListSessions } from "./opencode-sessions";
import type { ProcessIo } from "./process-io";
import { retractPendingQuestions } from "./questions";
import { OPENCODE_SESSION_CAPABILITIES } from "./session-capabilities";
import { bumpTurnEpoch } from "./turn-epoch";
import { type AgentHandle, STATUS_SNAPSHOT_STATUS } from "./types";

/** Serve has no stateful model setter — the model rides on EVERY prompt
 * (ASSUMPTION). `setModel` stores the split "provider/model" string. */
interface ServeModelRef {
	current?: { modelID: string; providerID: string };
}

function parseServeModelRef(model: string): ServeModelRef["current"] {
	const separator = model.indexOf("/");
	const isValid = separator > 0 && separator !== model.length - 1;
	return isValid
		? {
				providerID: model.slice(0, separator),
				modelID: model.slice(separator + 1),
			}
		: undefined;
}

/** Cancels the in-flight turn and retracts any pending approval/question —
 * split out of `makeServeControls` to keep it under the max-lines-per-
 * function gate. */
function makeServeInterrupt(ctx: ServeSessionContext): () => void {
	return () => {
		// RC-T3: supersede the current turn and retract any pending approval
		// (pending permission request) BEFORE aborting the remote turn, so a
		// straggler SSE event or a late approval answer can never land against
		// a turn context that's already moved on — mirrors claude-code.ts's
		// `interrupt()`. R3-T3: same for a pending question.
		bumpTurnEpoch(ctx.epoch);
		retractPendingApprovals(ctx.approvals, ctx.events);
		retractPendingQuestions(ctx.questions, ctx.events);
		// ASSUMPTION (unverified): `POST /session/:id/abort` cancels the
		// in-flight turn but keeps the session alive.
		firePost(
			ctx.http,
			`/session/${ctx.sessionId}/abort`,
			undefined,
			ctx.events
		);
	};
}

export function makeServeControls(
	ctx: ServeSessionContext,
	modelRef: ServeModelRef,
	agentRef: ServeAgentRef
): Pick<AgentHandle, "send" | "setModel" | "interrupt" | "setPermissionMode"> {
	return {
		send(text: string): void {
			// A new turn begins — bump the epoch BEFORE pushing the user's own
			// turn-start event (see the RC-T3 note on `opencodeServeAdapter.start`).
			bumpTurnEpoch(ctx.epoch);
			ctx.events.push(userMessageEvent(text));
			const body: Record<string, unknown> = {
				parts: [{ type: "text", text }],
			};
			if (modelRef.current !== undefined) {
				body.model = modelRef.current;
			}
			if (agentRef.current !== undefined) {
				body.agent = agentRef.current;
			}
			// RC-T5: no request timeout on the turn POST — it blocks until the
			// turn actually finishes (routinely >15s with tool calls/thinking),
			// while progress streams in over SSE; a genuinely wedged turn is the
			// activity watchdog's job (session-watchdog.ts), not this call's.
			firePost(
				ctx.http,
				`/session/${ctx.sessionId}/message`,
				body,
				ctx.events,
				null
			);
		},
		setModel(model: string): void {
			const parsed = parseServeModelRef(model);
			if (parsed === undefined) {
				ctx.events.push({
					kind: "status",
					status: "model_format_invalid",
					detail: { model, expected: "provider/model" },
				});
				return;
			}
			modelRef.current = parsed;
		},
		// R2-T3 item 7, ASSUMPTION (unverified): see `ServeAgentRef`'s own doc
		// comment (opencode-serve-agent.ts) for why this stores rather than
		// POSTs immediately — the deprecated `/mode` route is deliberately not
		// used here.
		setPermissionMode(mode: string): void {
			agentRef.current = mode;
		},
		interrupt: makeServeInterrupt(ctx),
	};
}

/** Builds the `getStatus` control: GETs the serve session's message history
 * and maps the latest assistant message's cost/tokens/model into ONE
 * `status_snapshot` event. A fetch failure pushes a snapshot with every field
 * absent rather than throwing — matching every other adapter's posture. */
export function makeServeGetStatus(ctx: ServeSessionContext): () => void {
	return () => {
		ctx.http
			.getJson(`/session/${ctx.sessionId}/message`)
			.then((raw) => {
				ctx.events.push({
					kind: "status",
					status: STATUS_SNAPSHOT_STATUS,
					detail: parseOpencodeServeStatus(raw),
				});
			})
			.catch(() => {
				ctx.events.push({
					kind: "status",
					status: STATUS_SNAPSHOT_STATUS,
					detail: {},
				});
			});
	};
}

/** `ctx.events` is typed as the narrower push-only `EventSink` (so most
 * consumers can't accidentally iterate/close it); `AgentHandle.events` needs
 * the full `AsyncQueue` (it's what `runBridgeSession` iterates) — so `start`
 * passes its own already-typed `events` local through explicitly rather than
 * re-reading it off `ctx`. `io`/`sseAbort`/`agentRef` are bundled into one
 * object purely to keep this under the repo's max-params gate. */
export function buildServeHandle(
	ctx: ServeSessionContext,
	events: AsyncQueue<NormalizedEvent>,
	handleDeps: {
		agentRef: ServeAgentRef;
		/** P4-T1: the project directory `listSessions` filters the store by. */
		dir: string;
		io: ProcessIo;
		sseAbort: AbortController;
	}
): AgentHandle {
	const { approvals, epoch, questions } = ctx;
	const { agentRef, dir, io, sseAbort } = handleDeps;
	return {
		answerApproval(requestId: string, optionId: string): void {
			approvals.answer(requestId, optionId);
		},
		answerQuestion(requestId: string, answers: string[][]): void {
			questions.answer(requestId, answers);
		},
		events,
		getStatus: makeServeGetStatus(ctx),
		// P4-T1/T5: same on-disk SQLite store as the ACP transport — see
		// opencode-sessions.ts / opencode-search.ts.
		listSessions: makeOpencodeListSessions(dir, events),
		searchSessions: makeOpencodeSearchSessions(dir, events),
		...makeServeControls(ctx, {}, agentRef),
		stop(): void {
			bumpTurnEpoch(epoch);
			// Retract before close(): a push after the queue is closed is a
			// silent no-op (see async-queue.ts), so the cancelled
			// ApprovalEvent/QuestionEvent must land first.
			retractPendingApprovals(approvals, events);
			retractPendingQuestions(questions, events);
			sseAbort.abort();
			io.stop();
			events.close();
			approvals.clear();
			questions.clear();
		},
	};
}

/** Pushes the one-time `session_ready` event — keeps `start` under the
 * max-lines-per-function gate. */
export function pushServeSessionReady(
	ctx: ServeSessionContext,
	dir: string,
	models: string[],
	permissionModes: string[]
): void {
	ctx.events.push({
		kind: "status",
		status: "session_ready",
		detail: {
			cwd: dir,
			sessionId: ctx.sessionId,
			models,
			permissionModes,
			// R2-T3's live GET /agent list wins over the ACP-only static pair.
			capabilities: { ...OPENCODE_SESSION_CAPABILITIES, permissionModes },
		},
	});
}

/** R5-T1: pushes the one-time `command_catalog` event off `GET /command` —
 * separate from `session_ready` (mirrors codex/pi, unlike models/permission
 * modes here), and skipped entirely on an empty catalog (an old server
 * without the route, or a genuinely empty one — either way, nothing to
 * show). */
export function pushServeCommandCatalog(
	ctx: ServeSessionContext,
	commands: OpencodeServeCommand[]
): void {
	if (commands.length === 0) {
		return;
	}
	ctx.events.push({
		kind: "status",
		status: "command_catalog",
		detail: { commands },
	});
}
