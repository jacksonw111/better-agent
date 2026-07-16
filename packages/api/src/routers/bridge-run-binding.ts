import type { RunRow } from "@better-agent/agent/task-ports";
import { ORPCError } from "@orpc/server";
import type { Context } from "../context";

// S2-T2 (design D4): startSession's optional runId. A Run's pre-issued
// session credential (runs.session_token_id, see
// @better-agent/agent/task/run-session-credential.ts) starts the relay
// session it was minted for; this helper enforces that the calling token IS
// that credential before any binding happens. Split out of bridge.ts to keep
// the startSession handler under the max-lines-per-function gate.

/** Resolves the Run for a runId-carrying startSession, or throws UNAUTHORIZED
 * when the token isn't that Run's pre-issued session credential. An unknown
 * run and a mismatched token fail identically — no oracle. */
export async function requireRunForSessionToken(
	context: Context,
	runId: string,
	tokenId: string
): Promise<RunRow> {
	const run = await context.services.stores.run.getById(runId);
	if (!run || run.sessionTokenId !== tokenId) {
		throw new ORPCError("UNAUTHORIZED", {
			message: "Token is not this run's session credential",
		});
	}
	return run;
}
