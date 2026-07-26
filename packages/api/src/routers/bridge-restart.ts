import { z } from "zod";
import { requireOwnedBridgeSession } from "../bridge/ownership";
import { bridgeProcedure, userProcedure } from "../index";
import { resolveMcpServers } from "./bridge-mcp-resolve";
import { resolveSkills } from "./bridge-skills-resolve";

// R3 "restart orchestration": the web can ask a live local agent to restart
// in place (same sessionId, fresh process) instead of ending the session and
// starting a new one. Split out of bridge.ts to keep that file under the
// 300-line cap — mirrors bridge-usage.ts / bridge-push-events.ts.

/** Appended to a session's `commands↓` by `restartSession`, so the CLI's poll
 * loop (see `apps/bridge-cli/src/commands.ts`'s `parseCommandText`) tells the
 * local agent process to restart instead of stop. Sibling of
 * `STOP_CONTROL_COMMAND` in bridge.ts. */
export const RESTART_CONTROL_COMMAND = {
	type: "control",
	action: "restart",
} as const;

const sessionIdInput = z.object({ sessionId: z.string() });

/** Owner-scoped: appends a `control:restart` command to the session's relay
 * channel, best-effort like `endSession`'s stop append. Unlike `endSession`,
 * this does NOT flip the session to "ended" — a restart keeps the same
 * session alive so the CLI can seamlessly reconnect the same sessionId. */
export const restartSession = userProcedure
	.input(sessionIdInput)
	.handler(async ({ input, context }) => {
		await requireOwnedBridgeSession(
			context,
			context.authedUser.id,
			input.sessionId
		);
		try {
			// Best-effort: see STOP_CONTROL_COMMAND's comment in bridge.ts for why
			// a transient relay failure here must not fail the call.
			await context.services.relayStore.append(
				input.sessionId,
				"commands",
				RESTART_CONTROL_COMMAND
			);
		} catch {
			// swallow — see comment above.
		}
		return { ok: true };
	});

/** Bridge-token-authed: returns the calling token's current persisted
 * startup config, the same shape `startSession` returns for `config` (plus
 * the same resolved `mcpServers`/`skills`, R5-a/R5-T2). Lets a restarting CLI
 * re-fetch fresh settings without minting a new session (which calling
 * `startSession` again would do, breaking seamless reconnect). */
export const fetchConfig = bridgeProcedure.handler(async ({ context }) => {
	const { userId, tokenId } = context.authedBridgeToken;
	const token = await context.services.stores.bridgeToken.getById(
		tokenId,
		userId
	);
	const mcpServers = await resolveMcpServers(
		context,
		userId,
		token?.config?.mcpServerIds
	);
	const skills = await resolveSkills(context, userId, token?.config?.skillIds);
	return { config: token?.config ?? null, mcpServers, skills };
});
