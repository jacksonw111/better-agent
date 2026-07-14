import { z } from "zod";
import { requireOwnedBridgeSession } from "../bridge/ownership";
import type { Context } from "../context";
import { userProcedure } from "../index";

// P3-T1 (docs/local-agent-workspace-plan.md): user-facing session lifecycle —
// end / rename / star / archive / restore / hard-delete — split out of
// bridge.ts to keep that file under the repo's 300-line cap (same precedent
// as bridge-list-sessions.ts / bridge-token-mgmt.ts). All routes are
// ownership-checked via requireOwnedBridgeSession, and the store methods are
// additionally userId-guarded, so a non-owner can neither read nor mutate.

/** Appended to a session's `commands↓` when the web ends (or archives/deletes
 * a still-active) session, so the CLI's poll loop (see
 * `apps/bridge-cli/src/commands.ts`'s `parseCommandText`) tells the local
 * agent process to stop instead of the DB flip alone leaving it running
 * forever. */
const STOP_CONTROL_COMMAND = { type: "control", action: "stop" } as const;

/** Hard cap on a web-set session name; anything longer is a client bug. */
const MAX_SESSION_NAME_LENGTH = 200;

const sessionIdInput = z.object({ sessionId: z.uuid() });

/** Best-effort stop: the DB write that precedes this is authoritative, so a
 * transient relay failure must not fail the call — otherwise the UI would see
 * an error, keep showing the action as if nothing happened, yet the DB
 * already reflects it and a retry could never re-send the stop, leaving the
 * local agent running forever. The CLI still notices the session ended via
 * its own polling/error handling even without this control command. */
async function sendStopControl(
	context: Context,
	sessionId: string
): Promise<void> {
	try {
		await context.services.relayStore.append(
			sessionId,
			"commands",
			STOP_CONTROL_COMMAND
		);
		context.services.commandBus.notify(sessionId);
	} catch {
		// swallow — see doc comment above.
	}
}

export const endSession = userProcedure
	.input(sessionIdInput)
	.handler(async ({ input, context }) => {
		await requireOwnedBridgeSession(
			context,
			context.authedUser.id,
			input.sessionId
		);
		await context.services.stores.bridgeSession.end(
			input.sessionId,
			context.authedUser.id
		);
		await sendStopControl(context, input.sessionId);
		return { ok: true };
	});

/** Sets the user's display name for a session (`name`), shown ahead of the
 * CLI's launch-time `label`. Whitespace is trimmed; an empty (or null) name
 * clears the rename, falling back to the label. */
export const renameSession = userProcedure
	.input(
		z.object({
			sessionId: z.uuid(),
			name: z.string().max(MAX_SESSION_NAME_LENGTH).nullable(),
		})
	)
	.handler(async ({ input, context }) => {
		await requireOwnedBridgeSession(
			context,
			context.authedUser.id,
			input.sessionId
		);
		const trimmed = input.name?.trim() ?? "";
		await context.services.stores.bridgeSession.rename(
			input.sessionId,
			context.authedUser.id,
			trimmed === "" ? null : trimmed
		);
		return { ok: true };
	});

export const starSession = userProcedure
	.input(z.object({ sessionId: z.uuid(), starred: z.boolean() }))
	.handler(async ({ input, context }) => {
		await requireOwnedBridgeSession(
			context,
			context.authedUser.id,
			input.sessionId
		);
		await context.services.stores.bridgeSession.setStarred(
			input.sessionId,
			context.authedUser.id,
			input.starred
		);
		return { ok: true };
	});

/** Archives a session out of the default list. A still-ACTIVE session is
 * first ended (DB flip + best-effort stop control, same as endSession) so
 * archiving can never leave a hidden agent running. */
export const archiveSession = userProcedure
	.input(sessionIdInput)
	.handler(async ({ input, context }) => {
		await requireOwnedBridgeSession(
			context,
			context.authedUser.id,
			input.sessionId
		);
		const row = await context.services.stores.bridgeSession.get(
			input.sessionId
		);
		if (row?.status === "active") {
			await context.services.stores.bridgeSession.end(
				input.sessionId,
				context.authedUser.id
			);
			await sendStopControl(context, input.sessionId);
		}
		await context.services.stores.bridgeSession.setArchived(
			input.sessionId,
			context.authedUser.id,
			true
		);
		return { ok: true };
	});

/** Un-archives a session back into the default list. Its status stays as it
 * was (archiving already ended it) — restore is about visibility, not
 * resurrecting the CLI run. */
export const restoreSession = userProcedure
	.input(sessionIdInput)
	.handler(async ({ input, context }) => {
		await requireOwnedBridgeSession(
			context,
			context.authedUser.id,
			input.sessionId
		);
		await context.services.stores.bridgeSession.setArchived(
			input.sessionId,
			context.authedUser.id,
			false
		);
		return { ok: true };
	});

/** Hard-deletes the session row and its persisted history. A still-ACTIVE
 * session first gets the best-effort stop control so the local agent isn't
 * left running against a session that no longer exists. */
export const deleteSession = userProcedure
	.input(sessionIdInput)
	.handler(async ({ input, context }) => {
		await requireOwnedBridgeSession(
			context,
			context.authedUser.id,
			input.sessionId
		);
		const row = await context.services.stores.bridgeSession.get(
			input.sessionId
		);
		if (row?.status === "active") {
			await sendStopControl(context, input.sessionId);
		}
		await context.services.stores.bridgeSession.deleteHard(
			input.sessionId,
			context.authedUser.id
		);
		return { ok: true };
	});
