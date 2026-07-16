import type { AgentValidator } from "@better-agent/agent/agent/agent-validator";
import type { AgentConfig } from "@better-agent/agent/agent/types";
import type { AgentStore } from "@better-agent/agent/ports";
import { ORPCError } from "@orpc/server";
import { z } from "zod";
import type { Context } from "../context";
import { authorizedUserProcedure } from "../index";
import { assembleAgentToolDefs } from "./agent-tool-defs";

const paramsInput = z.object({
	temperature: z.number().min(0).max(2).nullable().default(null),
	topP: z.number().min(0).max(1).nullable().default(null),
	maxOutputTokens: z.number().int().positive().nullable().default(null),
});

const agentInput = z.object({
	name: z.string().min(1),
	description: z.string().min(1),
	systemPrompt: z.string().min(1),
	providerId: z.string().min(1),
	modelId: z.string().min(1),
	params: paramsInput.nullable().default(null),
	composioAccountIds: z.array(z.uuid()).default([]),
	openConnectorAccountIds: z.array(z.uuid()).default([]),
	mcpServerIds: z.array(z.uuid()).default([]),
	toolAllowlist: z.array(z.string()).nullable().default(null),
	builtinTools: z.array(z.string()).default([]),
});

const idInput = z.object({ id: z.uuid() });

async function assertValidAgent(
	validator: AgentValidator,
	input: { providerId: string; modelId: string }
): Promise<void> {
	const error = await validator.validate(input);
	if (error) {
		throw new ORPCError("BAD_REQUEST", { message: error });
	}
}

// A user may only wire THEIR OWN composio accounts / MCP servers into an agent
// — a foreign id would let them use someone else's credentials.
// Keep only the ids the user actually owns. Non-owned or since-deleted ids are
// dropped rather than rejected: editing an agent that still references a
// deleted source must not lock the whole save (and a user can only ever end up
// linked to their own sources this way).
async function filterOwnedIds(
	listByUser: (userId: string) => Promise<Array<{ id: string }>>,
	userId: string,
	ids: string[]
): Promise<string[]> {
	if (ids.length === 0) {
		return [];
	}
	const owned = new Set((await listByUser(userId)).map((row) => row.id));
	return ids.filter((id) => owned.has(id));
}

async function filterOwnedLinks(
	context: Context,
	userId: string,
	input: {
		composioAccountIds: string[];
		openConnectorAccountIds: string[];
		mcpServerIds: string[];
	}
): Promise<{
	composioAccountIds: string[];
	openConnectorAccountIds: string[];
	mcpServerIds: string[];
}> {
	const { composioAccount, openConnectorAccount, mcpServer } =
		context.services.stores;
	const [composioAccountIds, openConnectorAccountIds, mcpServerIds] =
		await Promise.all([
			filterOwnedIds(
				(id) => composioAccount.listByUser(id),
				userId,
				input.composioAccountIds
			),
			filterOwnedIds(
				(id) => openConnectorAccount.listByUser(id),
				userId,
				input.openConnectorAccountIds
			),
			filterOwnedIds(
				(id) => mcpServer.listByUser(id),
				userId,
				input.mcpServerIds
			),
		]);
	return { composioAccountIds, openConnectorAccountIds, mcpServerIds };
}

// Loads an agent and asserts the caller owns it. NOT_FOUND for both missing and
// other-owner agents, so ownership never leaks.
async function requireOwnedAgent(
	store: AgentStore,
	userId: string,
	id: string
): Promise<AgentConfig> {
	const agent = await store.get(id);
	if (!agent || agent.userId !== userId) {
		throw new ORPCError("NOT_FOUND", { message: `Agent ${id} not found` });
	}
	return agent;
}

export const agentsRouter = {
	list: authorizedUserProcedure.handler(({ context }) =>
		context.services.stores.agent.listByUser(context.authedUser.id)
	),

	// The tools this agent carries RIGHT NOW — the same assembly a chat turn
	// runs (composio accounts + MCP servers + built-ins). Powers the composer's
	// tools popover.
	tools: authorizedUserProcedure
		.input(idInput)
		.handler(async ({ input, context }) => {
			const agent = await requireOwnedAgent(
				context.services.stores.agent,
				context.authedUser.id,
				input.id
			);
			const { defs } = await assembleAgentToolDefs(context, agent);
			return defs.map((def) => ({
				name: def.name,
				description: def.description,
			}));
		}),

	get: authorizedUserProcedure
		.input(idInput)
		.handler(({ input, context }) =>
			requireOwnedAgent(
				context.services.stores.agent,
				context.authedUser.id,
				input.id
			)
		),

	// Returns the agent's current token so its owner can reuse it for chat.
	getToken: authorizedUserProcedure
		.input(idInput)
		.handler(async ({ input, context }) => {
			await requireOwnedAgent(
				context.services.stores.agent,
				context.authedUser.id,
				input.id
			);
			return context.services.stores.agent.getToken(input.id);
		}),

	create: authorizedUserProcedure
		.input(agentInput)
		.handler(async ({ input, context }) => {
			await assertValidAgent(context.services.agentValidator, {
				providerId: input.providerId,
				modelId: input.modelId,
			});
			const ownedLinks = await filterOwnedLinks(
				context,
				context.authedUser.id,
				input
			);
			const { token, hash } = context.services.tokenService.generate();
			const agent = await context.services.stores.agent.create({
				...input,
				...ownedLinks,
				tokenHash: hash,
				token,
				userId: context.authedUser.id,
			});
			await context.services.stores.activity.log({
				userId: context.authedUser.id,
				type: "agent_created",
				summary: `Created agent “${agent.name}”`,
			});
			return { agent, token };
		}),

	rotateToken: authorizedUserProcedure
		.input(idInput)
		.handler(async ({ input, context }) => {
			await requireOwnedAgent(
				context.services.stores.agent,
				context.authedUser.id,
				input.id
			);
			const { token, hash } = context.services.tokenService.generate();
			const agent = await context.services.stores.agent.rotateToken(
				input.id,
				hash,
				token
			);
			if (!agent) {
				throw new ORPCError("NOT_FOUND", {
					message: `Agent ${input.id} not found`,
				});
			}
			return { agent, token };
		}),

	update: authorizedUserProcedure
		.input(idInput.extend(agentInput.shape))
		.handler(async ({ input, context }) => {
			const { id, ...rest } = input;
			await requireOwnedAgent(
				context.services.stores.agent,
				context.authedUser.id,
				id
			);
			await assertValidAgent(context.services.agentValidator, {
				providerId: rest.providerId,
				modelId: rest.modelId,
			});
			const ownedLinks = await filterOwnedLinks(
				context,
				context.authedUser.id,
				rest
			);
			const updated = await context.services.stores.agent.update(id, {
				...rest,
				...ownedLinks,
			});
			if (!updated) {
				throw new ORPCError("NOT_FOUND", { message: `Agent ${id} not found` });
			}
			return updated;
		}),

	delete: authorizedUserProcedure
		.input(idInput)
		.handler(async ({ input, context }) => {
			const agent = await requireOwnedAgent(
				context.services.stores.agent,
				context.authedUser.id,
				input.id
			);
			await context.services.stores.agent.delete(input.id);
			await context.services.stores.activity.log({
				userId: context.authedUser.id,
				type: "agent_deleted",
				summary: `Deleted agent “${agent.name}”`,
			});
			return { ok: true };
		}),
};
