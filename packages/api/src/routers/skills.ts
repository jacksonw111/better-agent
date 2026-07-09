import type { SkillRow } from "@better-agent/agent/ports";
import { ORPCError } from "@orpc/server";
import { z } from "zod";
import type { Context } from "../context";
import { authorizedUserProcedure } from "../index";

// The skills router: reusable method/procedure bundles assignable to an
// agent (web-agent Skills, T1 stored them via SkillStore). Every procedure is
// owner-scoped — a skill/agent id is asserted to belong to the caller before
// any read or write, mirroring memory.ts.

const idInput = z.object({ skillId: z.uuid() });
const agentIdInput = z.object({ agentId: z.uuid() });
const assignInput = agentIdInput.extend({ skillId: z.uuid() });

const skillInput = z.object({
	name: z.string().min(1),
	description: z.string().min(1),
	instructions: z.string().min(1),
	allowedTools: z.array(z.string().min(1)).optional(),
	mcpServerIds: z.array(z.uuid()).optional(),
});

const updateInput = idInput.extend(skillInput.partial().shape);

// A user may only wire THEIR OWN MCP servers into a skill — a foreign id
// would let them run someone else's MCP server (with that owner's stored
// auth header) once the skill is assigned to one of the caller's agents and
// activated. Mirrors filterOwnedIds in agents.ts. Non-owned or since-deleted
// ids are dropped rather than rejected, so a save never locks up over a
// stale link.
async function filterOwnedMcpServerIds(
	context: Context,
	userId: string,
	mcpServerIds: string[]
): Promise<string[]> {
	if (mcpServerIds.length === 0) {
		return mcpServerIds;
	}
	const owned = new Set(
		(await context.services.stores.mcpServer.listByUser(userId)).map(
			(row) => row.id
		)
	);
	return mcpServerIds.filter((id) => owned.has(id));
}

// Loads a skill and asserts the caller owns it. NOT_FOUND for both missing and
// other-owner skills, so ownership never leaks.
async function requireOwnedSkill(
	context: Context,
	userId: string,
	skillId: string
): Promise<SkillRow> {
	const skill = await context.services.stores.skill.get(skillId);
	if (!skill || skill.userId !== userId) {
		throw new ORPCError("NOT_FOUND", { message: "Skill not found" });
	}
	return skill;
}

// Asserts the caller owns the agent, without returning it (assign/unassign/
// listAssigned only need the ownership check).
async function requireOwnedAgentId(
	context: Context,
	userId: string,
	agentId: string
): Promise<void> {
	const agent = await context.services.stores.agent.get(agentId);
	if (!agent || agent.userId !== userId) {
		throw new ORPCError("NOT_FOUND", { message: "Agent not found" });
	}
}

export const skillsRouter = {
	create: authorizedUserProcedure
		.input(skillInput)
		.handler(async ({ input, context }) => {
			// Only touch mcpServerIds when the caller actually sent it — see the
			// note in `update` for why an explicit `undefined` key must be avoided.
			if (input.mcpServerIds !== undefined) {
				input.mcpServerIds = await filterOwnedMcpServerIds(
					context,
					context.authedUser.id,
					input.mcpServerIds
				);
			}
			return context.services.stores.skill.create({
				userId: context.authedUser.id,
				...input,
			});
		}),

	list: authorizedUserProcedure.handler(({ context }) =>
		context.services.stores.skill.listByUser(context.authedUser.id)
	),

	get: authorizedUserProcedure
		.input(idInput)
		.handler(({ input, context }) =>
			requireOwnedSkill(context, context.authedUser.id, input.skillId)
		),

	update: authorizedUserProcedure
		.input(updateInput)
		.handler(async ({ input, context }) => {
			const { skillId, ...patch } = input;
			await requireOwnedSkill(context, context.authedUser.id, skillId);
			// Only touch mcpServerIds when the caller actually sent it — adding an
			// explicit `mcpServerIds: undefined` key here would make the store
			// treat "field omitted" as "clear the field", wiping the skill's
			// existing MCP servers on every unrelated edit.
			if (patch.mcpServerIds !== undefined) {
				patch.mcpServerIds = await filterOwnedMcpServerIds(
					context,
					context.authedUser.id,
					patch.mcpServerIds
				);
			}
			const updated = await context.services.stores.skill.update(
				skillId,
				context.authedUser.id,
				patch
			);
			if (!updated) {
				throw new ORPCError("NOT_FOUND", { message: "Skill not found" });
			}
			return updated;
		}),

	delete: authorizedUserProcedure
		.input(idInput)
		.handler(async ({ input, context }) => {
			await requireOwnedSkill(context, context.authedUser.id, input.skillId);
			await context.services.stores.skill.delete(
				input.skillId,
				context.authedUser.id
			);
			return { ok: true };
		}),

	assignAgent: authorizedUserProcedure
		.input(assignInput)
		.handler(async ({ input, context }) => {
			await requireOwnedAgentId(context, context.authedUser.id, input.agentId);
			await requireOwnedSkill(context, context.authedUser.id, input.skillId);
			await context.services.stores.skill.assignAgent(input);
			return { ok: true };
		}),

	unassignAgent: authorizedUserProcedure
		.input(assignInput)
		.handler(async ({ input, context }) => {
			await requireOwnedAgentId(context, context.authedUser.id, input.agentId);
			await requireOwnedSkill(context, context.authedUser.id, input.skillId);
			await context.services.stores.skill.unassignAgent(
				input.agentId,
				input.skillId
			);
			return { ok: true };
		}),

	listAssigned: authorizedUserProcedure
		.input(agentIdInput)
		.handler(async ({ input, context }) => {
			await requireOwnedAgentId(context, context.authedUser.id, input.agentId);
			return context.services.stores.skill.listAgentSkills(input.agentId);
		}),
};
