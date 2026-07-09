// Split out of opencode-serve.ts purely to keep both files under the repo's
// max-lines-per-file gate. RC-T4: routes the `opencode serve` SSE stream's
// approval events through the shared fail-closed contract.

import { createOpencodeServeNormalizer } from "../normalize/opencode-serve";
import { presentApproval } from "./approvals";
import type { ServeSessionContext } from "./opencode-serve";
import { firePost, pumpServeEvents } from "./opencode-serve-http";
import { AGENT_EXITED_STATUS } from "./types";

/** `SERVE_PERMISSION_OPTIONS`'s "Deny" id (normalize/opencode-serve.ts) — what
 * RC-T4's shared timeout posts when nobody answers a permission in time. */
const SERVE_DENY_OPTION_ID = "reject";

function postPermissionReply(
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

/** Routes the SSE stream through this session's normalizer; an approval event
 * goes through the shared RC-T4 fail-closed contract (`presentApproval`)
 * instead of a bare `approvals.register` — presents the card, replies via
 * `POST …/permissions/:id` (ASSUMPTION, unverified: body
 * `{ response: <optionId> }`), and on timeout posts "reject" and pushes a
 * visible timed-out event instead of leaving the permission blocked forever.
 * Detached — a stream failure after `stop()`/exit (signal aborted) is
 * silent. */
export function wireServeEventStream(
	ctx: ServeSessionContext,
	signal: AbortSignal
): void {
	const normalize = createOpencodeServeNormalizer(ctx.sessionId);
	const route = (data: unknown): void => {
		for (const event of normalize(data)) {
			if (event.kind !== "approval") {
				ctx.events.push(event);
				continue;
			}
			presentApproval({
				approvals: ctx.approvals,
				event,
				events: ctx.events,
				onAnswer: (optionId) =>
					postPermissionReply(ctx, event.requestId, optionId),
				onTimeout: () =>
					postPermissionReply(ctx, event.requestId, SERVE_DENY_OPTION_ID),
			});
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
