import { z } from "zod";
import { requireOwnedBridgeSession } from "../bridge/ownership";
import { bridgeProcedure } from "../index";
import {
	getBridgeAttachment,
	uploadBridgeAttachment,
} from "./bridge-attachments";
import { listSessions } from "./bridge-list-sessions";
import { resolveMcpServers } from "./bridge-mcp-resolve";
import { fetchConfig, restartSession } from "./bridge-restart";
import { requireRunForSessionToken } from "./bridge-run-binding";
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
