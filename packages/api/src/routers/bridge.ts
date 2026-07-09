import {
	generateToken,
	hashToken,
} from "@better-agent/agent/crypto/auth-tokens";
import { log } from "evlog";
import { z } from "zod";
import { requireOwnedBridgeSession } from "../bridge/ownership";
import type { Context } from "../context";
import { bridgeProcedure, userProcedure } from "../index";
import { appendPushedEvents } from "./bridge-push-events";
import { fetchConfig, restartSession } from "./bridge-restart";
import {
	assertEventsWithinSizeLimit,
	assertInputWithinSizeLimit,
} from "./bridge-size-limits";
import { usageByAgentKind } from "./bridge-usage";

const TOKEN_PREFIX = "bt_";
const LAST4 = 4;
const AGENT_KINDS = ["claude-code", "opencode", "codex", "pi"] as const;
/** Max events accepted in a single pushEvents call (spec §3.1: bounded window). */
const MAX_PUSH_BATCH = 50;
/** Appended to a session's `commands↓` by `endSession`, so the CLI's poll
 * loop (see `apps/bridge-cli/src/commands.ts`'s `parseCommandText`) tells the
 * local agent process to stop instead of the DB flip alone leaving it running
 * forever. */
const STOP_CONTROL_COMMAND = { type: "control", action: "stop" } as const;
/** Default page size for the `history` endpoint when `limit` is omitted. */
const DEFAULT_HISTORY_LIMIT = 500;
/** Hard cap on `history`'s `limit` input, to bound one query's result size. */
const MAX_HISTORY_LIMIT = 500;

const idInput = z.object({ id: z.uuid() });
const sessionIdInput = z.object({ sessionId: z.uuid() });
const pollInput = z.object({
	sessionId: z.uuid(),
	afterId: z.number().int().min(0),
});
const historyInput = z.object({
	sessionId: z.uuid(),
	afterSeq: z.number().int().min(0).default(0),
	limit: z
		.number()
		.int()
		.min(1)
		.max(MAX_HISTORY_LIMIT)
		.default(DEFAULT_HISTORY_LIMIT),
});

/** Best-effort persistence of a pushEvents batch as one multi-row insert —
 * logged and swallowed, since a failure must never break the live relay. */
async function persistEventsBestEffort(
	context: Context,
	sessionId: string,
	rows: { seq: number; event: unknown }[]
): Promise<void> {
	try {
		await context.services.stores.bridgeMessage.appendMany(sessionId, rows);
	} catch (err) {
		log.error({ action: "bridge pushEvents persist", error: String(err) });
	}
}

export const bridgeRouter = {
	// --- user-facing bridge-token management (owner-scoped) ---
	// Token is bound to a chosen agentKind at creation, stored so the owner can re-view it.
	createToken: userProcedure
		.input(
			z.object({
				agentKind: z.enum(AGENT_KINDS),
				name: z.string().min(1).optional(),
			})
		)
		.handler(async ({ input, context }) => {
			const token = generateToken(TOKEN_PREFIX);
			const created = await context.services.stores.bridgeToken.create({
				userId: context.authedUser.id,
				name: input.name,
				agentKind: input.agentKind,
				token,
				tokenHash: hashToken(token),
				last4: token.slice(-LAST4),
			});
			return { id: created.id, token, last4: token.slice(-LAST4) };
		}),

	listTokens: userProcedure.handler(({ context }) =>
		context.services.stores.bridgeToken.listByUser(context.authedUser.id)
	),

	getToken: userProcedure
		.input(idInput)
		.handler(({ input, context }) =>
			context.services.stores.bridgeToken.getById(
				input.id,
				context.authedUser.id
			)
		),

	// The only delete: removing a local agent removes its token + sessions + messages.
	deleteToken: userProcedure
		.input(idInput)
		.handler(async ({ input, context }) => {
			await context.services.stores.bridgeToken.deleteAgent(
				input.id,
				context.authedUser.id
			);
			return { ok: true };
		}),

	// Phase 4: persist a local agent's startup config (appendSystemPrompt,
	// maxTurns, …). The CLI fetches it via startSession and applies it at launch.
	updateTokenConfig: userProcedure
		.input(
			z.object({
				id: z.uuid(),
				config: z.object({
					appendSystemPrompt: z.string().optional(),
					effort: z.enum(["low", "medium", "high", "xhigh", "max"]).optional(),
					maxBudgetUsd: z.number().positive().optional(),
					maxTurns: z.number().int().positive().optional(),
					model: z.string().optional(),
					permissionMode: z.string().optional(),
				}),
			})
		)
		.handler(async ({ input, context }) => {
			const updated = await context.services.stores.bridgeToken.updateConfig(
				input.id,
				context.authedUser.id,
				input.config
			);
			return updated ? { ok: true } : { ok: false };
		}),

	// --- bridge-token (local CLI) endpoints ---
	startSession: bridgeProcedure
		.input(
			z.object({
				agentKind: z.enum(AGENT_KINDS),
				label: z.string().min(1).optional(),
			})
		)
		.handler(async ({ input, context }) => {
			const { userId, tokenId } = context.authedBridgeToken;
			const session = await context.services.stores.bridgeSession.create({
				userId,
				tokenId,
				agentKind: input.agentKind,
				label: input.label,
			});
			// Return the token's persisted startup config so the CLI can apply it
			// (appendSystemPrompt, maxTurns, …) when launching the agent.
			const token = await context.services.stores.bridgeToken.getById(
				tokenId,
				userId
			);
			return { sessionId: session.id, config: token?.config ?? null };
		}),

	pushEvents: bridgeProcedure
		.input(
			z.object({
				sessionId: z.uuid(),
				events: z.array(z.unknown()).max(MAX_PUSH_BATCH),
			})
		)
		.handler(async ({ input, context }) => {
			await requireOwnedBridgeSession(
				context,
				context.authedBridgeToken.userId,
				input.sessionId
			);
			assertEventsWithinSizeLimit(input.events);
			// Relay appends stay sequential (each assigns the next seq off the
			// previous one); Postgres persistence doesn't, so it's batched below.
			const persisted = await appendPushedEvents(
				context,
				input.sessionId,
				context.authedBridgeToken.userId,
				input.events
			);
			await persistEventsBestEffort(context, input.sessionId, persisted);
			await context.services.stores.bridgeSession.touch(input.sessionId);
			return { ok: true };
		}),

	fetchConfig,
	pollCommands: bridgeProcedure
		.input(pollInput)
		.handler(async ({ input, context }) => {
			await requireOwnedBridgeSession(
				context,
				context.authedBridgeToken.userId,
				input.sessionId
			);
			// The CLI polls this every couple seconds for as long as it's connected,
			// so it doubles as a liveness heartbeat: touch lastSeenAt here too, not
			// only on pushEvents — otherwise a connected-but-quiet agent (no output)
			// goes "idle" after the threshold while its stream is still Live.
			await context.services.stores.bridgeSession.touch(input.sessionId);
			return context.services.relayStore.read(
				input.sessionId,
				"commands",
				input.afterId
			);
		}),

	// --- web (user) endpoints ---
	observe: userProcedure
		.input(pollInput)
		.handler(async ({ input, context }) => {
			await requireOwnedBridgeSession(
				context,
				context.authedUser.id,
				input.sessionId
			);
			return context.services.relayStore.read(
				input.sessionId,
				"events",
				input.afterId
			);
		}),

	/** Persisted event history for a session, seeded on page load before the
	 * web switches to live `observe` polling. Shares seq numbering with
	 * `observe`'s relay ids so the caller can dedupe replayed-then-live
	 * events. */
	history: userProcedure
		.input(historyInput)
		.handler(async ({ input, context }) => {
			await requireOwnedBridgeSession(
				context,
				context.authedUser.id,
				input.sessionId
			);
			return context.services.stores.bridgeMessage.list(
				input.sessionId,
				input.afterSeq,
				input.limit
			);
		}),

	sendInput: userProcedure
		.input(z.object({ sessionId: z.uuid(), data: z.unknown() }))
		.handler(async ({ input, context }) => {
			await requireOwnedBridgeSession(
				context,
				context.authedUser.id,
				input.sessionId
			);
			assertInputWithinSizeLimit(input.data);
			await context.services.relayStore.append(
				input.sessionId,
				"commands",
				input.data
			);
			return { ok: true };
		}),

	listSessions: userProcedure.handler(({ context }) =>
		context.services.stores.bridgeSession.listByUser(context.authedUser.id)
	),
	// Local Agent usage by agent kind, same rolling window as chat usage (owner-scoped).
	usageByAgentKind,

	endSession: userProcedure
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
			try {
				// Best-effort: the DB flip above is authoritative for "ended", so a
				// transient relay failure here must not fail the call — otherwise the
				// UI would see an error, keep showing the End button as if nothing
				// happened, yet the DB already reads "ended" and a retry can never
				// re-send the stop, leaving the local agent running forever. The CLI
				// will still notice the session ended via its own polling/error
				// handling even without this control command.
				await context.services.relayStore.append(
					input.sessionId,
					"commands",
					STOP_CONTROL_COMMAND
				);
			} catch {
				// swallow — see comment above.
			}
			return { ok: true };
		}),
	restartSession,
};
