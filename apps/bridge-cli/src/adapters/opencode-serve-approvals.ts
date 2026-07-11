// Split out of opencode-serve.ts purely to keep both files under the repo's
// max-lines-per-file gate. RC-T4: routes the `opencode serve` SSE stream's
// approval events through the shared fail-closed contract. R3-T3: also
// routes `question.asked` (a SEPARATE event family) through the parallel
// question contract, and switches the permission reply to the new
// `POST /permission/:id/reply` route (with a fallback to the deprecated
// `POST /session/:id/permissions/:id` route — see `postPermissionReply`).

import { createOpencodeServeNormalizer } from "../normalize/opencode-serve";
import { presentApproval } from "./approvals";
import type { ServeSessionContext } from "./opencode-serve";
import {
	firePost,
	pumpServeEvents,
	ServeHttpError,
} from "./opencode-serve-http";
import { presentQuestion } from "./questions";
import { AGENT_EXITED_STATUS } from "./types";

/** `SERVE_PERMISSION_OPTIONS`'s "Deny" id (normalize/opencode-serve.ts) — what
 * RC-T4's shared timeout posts when nobody answers a permission in time. */
const SERVE_DENY_OPTION_ID = "reject";

const HTTP_NOT_FOUND = 404;

/** The deprecated `POST /session/:id/permissions/:id` route (ASSUMPTION,
 * unverified: body `{ response: <optionId> }`) — still exists per R3-T3's
 * source research, so it's the fallback when the health probe (R2-T3) says
 * this server predates the new route, or when the new route itself 404s. */
function postLegacyPermissionReply(
	ctx: ServeSessionContext,
	requestId: string,
	optionId: string
): void {
	firePost(
		ctx.http,
		`/session/${ctx.sessionId}/permissions/${requestId}`,
		{ response: optionId },
		ctx.events
	);
}

/** R3-T3 item 4: `POST /permission/:id/reply { reply, message? }` — the
 * current route, tried first unless `permissionRouteHint` already knows this
 * server is legacy. On an `"unknown"` hint (the health probe hadn't resolved
 * yet when this permission raced in — see `opencode-serve.ts`'s race-
 * condition note), a 404 falls back to the deprecated route ONCE and learns
 * `"legacy"` for the rest of the session; any other failure (or a 404 while
 * the hint already says `"new"`, which would be a genuinely unexpected
 * server error) is surfaced as an `error` event instead of silently
 * retrying, same posture as `firePost`. */
async function postNewPermissionReply(
	ctx: ServeSessionContext,
	requestId: string,
	optionId: string
): Promise<void> {
	try {
		await ctx.http.postJson(`/permission/${requestId}/reply`, {
			reply: optionId,
		});
		if (ctx.permissionRouteHint.current === "unknown") {
			ctx.permissionRouteHint.current = "new";
		}
	} catch (error) {
		const canFallBack =
			ctx.permissionRouteHint.current === "unknown" &&
			error instanceof ServeHttpError &&
			error.status === HTTP_NOT_FOUND;
		if (canFallBack) {
			ctx.permissionRouteHint.current = "legacy";
			postLegacyPermissionReply(ctx, requestId, optionId);
			return;
		}
		ctx.events.push({
			kind: "error",
			message: `opencode serve POST /permission/${requestId}/reply failed`,
			detail: error instanceof Error ? error.message : error,
		});
	}
}

/** Exported purely so opencode-serve-permission-route.test.ts can unit-test
 * the new/legacy/unknown route selection directly against a fake
 * `ServeSessionContext`, the same way opencode-serve-agent.test.ts unit-tests
 * `fetchServeAgents`/`fetchServeHealth` against a fake `ServeHttp` — going
 * through the full `startServe()` E2E helper can't exercise the `"unknown"`
 * race at all, since it always awaits `start()`'s health probe to completion
 * before handing a test its `handle`. */
export function postPermissionReply(
	ctx: ServeSessionContext,
	requestId: string,
	optionId: string
): void {
	if (ctx.permissionRouteHint.current === "legacy") {
		postLegacyPermissionReply(ctx, requestId, optionId);
		return;
	}
	// Fire-and-forget from the caller's perspective — postNewPermissionReply
	// never rejects, it converts every failure into either a legacy-route
	// fallback or a pushed `error` event.
	postNewPermissionReply(ctx, requestId, optionId);
}

/** R3-T3 item 2: replies to a pending `question.asked` request. An EMPTY
 * `answers` array is the documented reject path (`CommandSink.answerQuestion`'s
 * doc comment, commands.ts) — `POST /question/:id/reject` instead of
 * `/reply` with a vacuous payload. */
function postQuestionReply(
	ctx: ServeSessionContext,
	requestId: string,
	answers: string[][]
): void {
	if (answers.length === 0) {
		firePost(ctx.http, `/question/${requestId}/reject`, undefined, ctx.events);
		return;
	}
	firePost(ctx.http, `/question/${requestId}/reply`, { answers }, ctx.events);
}

/** Routes one normalized approval event through the shared RC-T4 fail-closed
 * contract — split out of `wireServeEventStream` purely to keep it under the
 * max-lines-per-function gate. */
function routeApproval(
	ctx: ServeSessionContext,
	event: Parameters<typeof presentApproval>[0]["event"]
): void {
	presentApproval({
		approvals: ctx.approvals,
		event,
		events: ctx.events,
		onAnswer: (optionId) => postPermissionReply(ctx, event.requestId, optionId),
		onTimeout: () =>
			postPermissionReply(ctx, event.requestId, SERVE_DENY_OPTION_ID),
	});
}

/** Routes one normalized question event through the parallel R3-T3
 * fail-closed contract — mirrors `routeApproval`. On timeout, posts the
 * reject path (opencode has no separate "declined" reply value for
 * questions the way permissions have `"reject"`). */
function routeQuestion(
	ctx: ServeSessionContext,
	event: Parameters<typeof presentQuestion>[0]["event"]
): void {
	presentQuestion({
		event,
		events: ctx.events,
		onAnswer: (answers) => postQuestionReply(ctx, event.requestId, answers),
		onTimeout: () => postQuestionReply(ctx, event.requestId, []),
		questions: ctx.questions,
	});
}

/** Routes the SSE stream through this session's normalizer; an approval event
 * goes through the shared RC-T4 fail-closed contract (`presentApproval`), a
 * question event through the parallel R3-T3 contract (`presentQuestion`) —
 * everything else is pushed straight onto `ctx.events`. Detached — a stream
 * failure after `stop()`/exit (signal aborted) is silent. */
export function wireServeEventStream(
	ctx: ServeSessionContext,
	signal: AbortSignal
): void {
	const normalize = createOpencodeServeNormalizer(ctx.sessionId);
	const route = (data: unknown): void => {
		for (const event of normalize(data)) {
			if (event.kind === "approval") {
				routeApproval(ctx, event);
			} else if (event.kind === "question") {
				routeQuestion(ctx, event);
			} else {
				ctx.events.push(event);
			}
		}
	};
	pumpServeEvents(ctx.http, signal, route).catch((error: unknown) => {
		if (signal.aborted) {
			return;
		}
		// RC-T5: a dead SSE reader (server crashed, connection dropped) must not
		// leave the session's event queue silent forever — surface it the same
		// way every stdio adapter's onExit does (AGENT_EXITED_STATUS, then
		// close()), so forwardEvents completes and runBridgeSession's own
		// teardown (which kills the still-running `opencode serve` subprocess
		// via `io.stop()`) runs promptly instead of the loop hanging.
		ctx.events.push({
			kind: "error",
			message: "opencode serve /event stream failed",
			detail: error instanceof Error ? error.message : error,
		});
		ctx.events.push({ kind: "status", status: AGENT_EXITED_STATUS });
		ctx.events.close();
	});
}
