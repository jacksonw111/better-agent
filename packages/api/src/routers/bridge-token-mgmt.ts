import {
	generateToken,
	hashToken,
} from "@better-agent/agent/crypto/auth-tokens";
import { z } from "zod";
import { userProcedure } from "../index";

// User-facing bridge-token management (owner-scoped): create/list/get/delete
// a local-agent token and edit its persisted startup config. Split out of
// bridge.ts to keep that file under the repo's 300-line cap — mirrors
// bridge-usage.ts / bridge-push-events.ts / bridge-restart.ts.

const TOKEN_PREFIX = "bt_";
const LAST4 = 4;
const AGENT_KINDS = ["claude-code", "opencode", "codex", "pi"] as const;

const idInput = z.object({ id: z.uuid() });

// Token is bound to a chosen agentKind at creation, stored so the owner can re-view it.
export const createToken = userProcedure
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
	});

export const listTokens = userProcedure.handler(({ context }) =>
	context.services.stores.bridgeToken.listByUser(context.authedUser.id)
);

export const getToken = userProcedure
	.input(idInput)
	.handler(({ input, context }) =>
		context.services.stores.bridgeToken.getById(input.id, context.authedUser.id)
	);

// The only delete: removing a local agent removes its token + sessions + messages.
export const deleteToken = userProcedure
	.input(idInput)
	.handler(async ({ input, context }) => {
		await context.services.stores.bridgeToken.deleteAgent(
			input.id,
			context.authedUser.id
		);
		return { ok: true };
	});

// Phase 4: persist a local agent's startup config (appendSystemPrompt,
// maxTurns, …). The CLI fetches it via startSession and applies it at launch.
// R5-a adds `mcpServerIds`, resolved into connection-ready `mcpServers` on
// read (see bridge-mcp-resolve.ts) rather than stored resolved.
export const updateTokenConfig = userProcedure
	.input(
		z.object({
			id: z.uuid(),
			config: z.object({
				appendSystemPrompt: z.string().optional(),
				effort: z.enum(["low", "medium", "high", "xhigh", "max"]).optional(),
				maxBudgetUsd: z.number().positive().optional(),
				maxTurns: z.number().int().positive().optional(),
				mcpServerIds: z.array(z.uuid()).optional(),
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
	});
