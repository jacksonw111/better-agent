import { z } from "zod";
import { ingestEvents, MAX_PUSH_BATCH } from "../bridge/ingest-events";
import { requireOwnedBridgeSession } from "../bridge/ownership";
import { bridgeProcedure, userProcedure } from "../index";
import { resolveMcpServers } from "./bridge-mcp-resolve";
import { fetchConfig, restartSession } from "./bridge-restart";
import { assertInputWithinSizeLimit } from "./bridge-size-limits";
import { resolveSkills } from "./bridge-skills-resolve";
import {
	createToken,
	deleteToken,
	getToken,
	listTokens,
	updateTokenConfig,
} from "./bridge-token-mgmt";
import { usageByAgentKind } from "./bridge-usage";

const AGENT_KINDS = ["claude-code", "opencode", "codex", "pi"] as const;
/** Appended to a session's `commands↓` by `endSession`, so the CLI's poll
 * loop (see `apps/bridge-cli/src/commands.ts`'s `parseCommandText`) tells the
 * local agent process to stop instead of the DB flip alone leaving it running
 * forever. */
const STOP_CONTROL_COMMAND = { type: "control", action: "stop" } as const;
/** Default page size for the `history` endpoint when `limit` is omitted. */
const DEFAULT_HISTORY_LIMIT = 500;
/** Hard cap on `history`'s `limit` input, to bound one query's result size. */
const MAX_HISTORY_LIMIT = 500;

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

export const bridgeRouter = {
	// --- user-facing bridge-token management (owner-scoped, bridge-token-mgmt.ts) ---
	createToken,
	listTokens,
	getToken,
	deleteToken,
	updateTokenConfig,

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
			// R5-a: resolve any assigned MCP server ids into connection-ready
			// servers (name/url/auth headers) alongside the raw config — see
			// bridge-mcp-resolve.ts's doc comment for the shape/rationale.
			const mcpServers = await resolveMcpServers(
				context,
				userId,
				token?.config?.mcpServerIds
			);
			// R5-T2: same resolve for the token's assigned skill ids — see
			// bridge-skills-resolve.ts's doc comment.
			const skills = await resolveSkills(
				context,
				userId,
				token?.config?.skillIds
			);
			return {
				sessionId: session.id,
				config: token?.config ?? null,
				mcpServers,
				skills,
			};
		}),

	pushEvents: bridgeProcedure
		.input(
			z
				.object({
					sessionId: z.uuid(),
					events: z.array(z.unknown()).max(MAX_PUSH_BATCH),
					// T1 (docs/remote-control-redesign-plan.md): the CLI's
					// client-minted idempotency key per event, aligned by index with
					// `events` — see relay-client.ts's `QueuedEvent`. Optional so
					// older/other CLI builds that don't send it still validate; those
					// simply get no dedup (the pre-T1 behavior).
					idempotencyKeys: z.array(z.string()).max(MAX_PUSH_BATCH).optional(),
				})
				.refine(
					(value) =>
						value.idempotencyKeys === undefined ||
						value.idempotencyKeys.length === value.events.length,
					{ message: "idempotencyKeys must align 1:1 with events" }
				)
		)
		.handler(async ({ input, context }) => {
			await requireOwnedBridgeSession(
				context,
				context.authedBridgeToken.userId,
				input.sessionId
			);
			await ingestEvents(context, {
				sessionId: input.sessionId,
				userId: context.authedBridgeToken.userId,
				events: input.events,
				idempotencyKeys: input.idempotencyKeys,
			});
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
			context.services.commandBus.notify(input.sessionId);
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
				context.services.commandBus.notify(input.sessionId);
			} catch {
				// swallow — see comment above.
			}
			return { ok: true };
		}),
	restartSession,
};
