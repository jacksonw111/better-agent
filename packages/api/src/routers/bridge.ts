import { z } from "zod";
import { ingestEvents, MAX_PUSH_BATCH } from "../bridge/ingest-events";
import { requireOwnedBridgeSession } from "../bridge/ownership";
import { bridgeProcedure, userProcedure } from "../index";
import {
	getBridgeAttachment,
	uploadBridgeAttachment,
} from "./bridge-attachments";
import { listSessions } from "./bridge-list-sessions";
import { resolveMcpServers } from "./bridge-mcp-resolve";
import { pendingRequests } from "./bridge-pending-requests";
import { fetchConfig, restartSession } from "./bridge-restart";
import { requireRunForSessionToken } from "./bridge-run-binding";
import { sendInput } from "./bridge-send-input";
import {
	archiveSession,
	deleteSession,
	endSession,
	renameSession,
	restoreSession,
	starSession,
} from "./bridge-session-mgmt";
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
/** Default page size for the `history` endpoint when `limit` is omitted. */
const DEFAULT_HISTORY_LIMIT = 500;
/** Hard cap on `history`'s `limit` input, to bound one query's result size. */
const MAX_HISTORY_LIMIT = 500;

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
				// S2-T2 (D4): set when the CLI starts a session with a Run's
				// pre-issued credential — binds bridge_sessions.run_id and
				// runs.session_id. Omitted by every pre-Run flow, which stays
				// byte-identical.
				runId: z.uuid().optional(),
			})
		)
		.handler(async ({ input, context }) => {
			const { userId, tokenId } = context.authedBridgeToken;
			const run = input.runId
				? await requireRunForSessionToken(context, input.runId, tokenId)
				: null;
			const session = await context.services.stores.bridgeSession.create({
				userId,
				tokenId,
				agentKind: input.agentKind,
				label: input.label,
				runId: run?.id,
			});
			if (run) {
				// The authoritative (FK-enforced) half of the binding.
				await context.services.stores.run.updateStatus(run.id, {
					sessionId: session.id,
				});
			}
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
	// The `--cua` CLI reports (or clears, with null) its live VNC endpoint for
	// the session so the web knows to mount the viewer. Bridge-token + owner
	// scoped, same as the other CLI-side endpoints.
	reportVnc: bridgeProcedure
		.input(
			z.object({ sessionId: z.uuid(), vncEndpoint: z.string().nullable() })
		)
		.handler(async ({ input, context }) => {
			await requireOwnedBridgeSession(
				context,
				context.authedBridgeToken.userId,
				input.sessionId
			);
			await context.services.stores.bridgeSession.setVncEndpoint(
				input.sessionId,
				input.vncEndpoint
			);
			return { ok: true };
		}),
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

	// fix-send-outbox: the web's reliable send path — see bridge-send-input.ts.
	sendInput,

	// P5-1: still-unanswered approval/question replay for (re)connect — see
	// bridge-pending-requests.ts.
	pendingRequests,

	// P3-T2: image input — web uploads against an owned bridge session (user
	// plane), the CLI downloads the bytes back (bridge-token plane) to inject
	// into the agent. See bridge-attachments.ts.
	uploadBridgeAttachment,
	getBridgeAttachment,

	// P2-T1: paginated + per-session attention signal — see bridge-list-sessions.ts.
	listSessions,
	// Local Agent usage by agent kind, same rolling window as chat usage (owner-scoped).
	usageByAgentKind,

	// P3-T1: session lifecycle (end/rename/star/archive/restore/hard-delete) —
	// see bridge-session-mgmt.ts.
	endSession,
	renameSession,
	starSession,
	archiveSession,
	restoreSession,
	deleteSession,
	restartSession,
};
