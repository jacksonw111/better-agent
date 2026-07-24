import { ORPCError } from "@orpc/server";
import { userProcedure } from "../index";
import {
	addItemInput,
	assignInput,
	createMemoryInput,
	embedAndAddItem,
	embedAndSearchItems,
	idInput,
	itemIdInput,
	listMemoriesInput,
	memoryIdInput,
	mutateAssignment,
	requireEmbedding,
	requireOwnedMemory,
	resolveScope,
	resolveTargetLinks,
	searchInput,
	setScopeInput,
	targetInput,
} from "./memory-support";

// The memory router: named, ownable, shareable knowledge bases (decision A1/C2).
// Every procedure is owner-scoped — a memory/agent/token is asserted to belong
// to the caller before any read or write. Writes embed content through the
// EmbeddingClient port; search is the kNN read path web + MCP both call.
export const memoryRouter = {
	createMemory: userProcedure
		.input(createMemoryInput)
		.handler(async ({ input, context }) => {
			const { scope, projectId } = await resolveScope(
				context,
				context.authedUser.id,
				input
			);
			return context.services.stores.memory.create({
				userId: context.authedUser.id,
				name: input.name,
				description: input.description,
				scope,
				projectId,
			});
		}),

	listMemories: userProcedure
		.input(listMemoriesInput)
		.handler(async ({ input, context }) => {
			const rows = await context.services.stores.memory.listByUser(
				context.authedUser.id
			);
			return input?.scope
				? rows.filter((row) => row.scope === input.scope)
				: rows;
		}),

	// DP2: re-home a memory between global and a project (project↔global). The
	// store clears/sets project_id to keep the invariant; NOT_FOUND when the
	// memory isn't the caller's.
	setMemoryScope: userProcedure
		.input(setScopeInput)
		.handler(async ({ input, context }) => {
			await requireOwnedMemory(context, context.authedUser.id, input.id);
			const { scope, projectId } = await resolveScope(
				context,
				context.authedUser.id,
				input
			);
			const updated = await context.services.stores.memory.setScope({
				id: input.id,
				userId: context.authedUser.id,
				scope,
				projectId,
			});
			if (!updated) {
				throw new ORPCError("NOT_FOUND", { message: "Memory not found" });
			}
			return updated;
		}),

	getMemory: userProcedure
		.input(idInput)
		.handler(({ input, context }) =>
			requireOwnedMemory(context, context.authedUser.id, input.id)
		),

	deleteMemory: userProcedure
		.input(idInput)
		.handler(async ({ input, context }) => {
			await requireOwnedMemory(context, context.authedUser.id, input.id);
			await context.services.stores.memory.deleteWithChildren(
				input.id,
				context.authedUser.id
			);
			return { ok: true };
		}),

	addItem: userProcedure
		.input(addItemInput)
		.handler(async ({ input, context }) => {
			await requireOwnedMemory(context, context.authedUser.id, input.memoryId);
			return embedAndAddItem(
				requireEmbedding(context),
				context.services.stores.memoryItem,
				{
					memoryId: input.memoryId,
					content: input.content,
					importance: input.importance,
				}
			);
		}),

	listItems: userProcedure
		.input(memoryIdInput)
		.handler(async ({ input, context }) => {
			await requireOwnedMemory(context, context.authedUser.id, input.memoryId);
			return context.services.stores.memoryItem.listCurrent(input.memoryId);
		}),

	deleteItem: userProcedure
		.input(itemIdInput)
		.handler(async ({ input, context }) => {
			const item = await context.services.stores.memoryItem.get(input.itemId);
			if (!item) {
				throw new ORPCError("NOT_FOUND", { message: "Memory item not found" });
			}
			await requireOwnedMemory(context, context.authedUser.id, item.memoryId);
			await context.services.stores.memoryItem.softDelete(input.itemId);
			return { ok: true };
		}),

	assignMemory: userProcedure
		.input(assignInput)
		.handler(async ({ input, context }) => {
			await mutateAssignment(context, context.authedUser.id, input, "assign");
			return { ok: true };
		}),

	unassignMemory: userProcedure
		.input(assignInput)
		.handler(async ({ input, context }) => {
			await mutateAssignment(context, context.authedUser.id, input, "unassign");
			return { ok: true };
		}),

	listAssigned: userProcedure
		.input(targetInput)
		.handler(async ({ input, context }) => {
			const links = await resolveTargetLinks(
				context,
				context.authedUser.id,
				input
			);
			const memories = await context.services.stores.memory.getMany(
				links.map((link) => link.memoryId)
			);
			const byId = new Map(memories.map((memory) => [memory.id, memory]));
			return links.map((link) => {
				const memory = byId.get(link.memoryId);
				return {
					memoryId: link.memoryId,
					role: link.role,
					name: memory?.name ?? null,
					description: memory?.description ?? null,
				};
			});
		}),

	search: userProcedure
		.input(searchInput)
		.handler(async ({ input, context }) => {
			const links = await resolveTargetLinks(
				context,
				context.authedUser.id,
				input
			);
			const memoryIds = links.map((link) => link.memoryId);
			if (memoryIds.length === 0) {
				return [];
			}
			return embedAndSearchItems(
				requireEmbedding(context),
				context.services.stores.memoryItem,
				{ query: input.query, memoryIds, k: input.k }
			);
		}),
};
