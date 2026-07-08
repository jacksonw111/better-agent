import type {
	AgentMemoryRow,
	EmbeddingClient,
	MemoryItemRow,
	MemoryItemSource,
	MemoryItemStore,
	MemoryRow,
} from "@better-agent/agent/ports";
import { ORPCError } from "@orpc/server";
import { z } from "zod";
import type { Context } from "../context";

// Shared input schemas + ownership/target-resolution helpers for the memory
// router, split out so memory.ts stays under the per-file line cap.

export const DEFAULT_SEARCH_K = 5;
const MAX_SEARCH_K = 50;
const MIN_IMPORTANCE = 0;
const MAX_IMPORTANCE = 1;

export const idInput = z.object({ id: z.uuid() });
export const memoryIdInput = z.object({ memoryId: z.uuid() });
export const itemIdInput = z.object({ itemId: z.uuid() });

// A memory is assigned to EITHER a web agent (agentId → agent_memories) OR a
// local agent (tokenId → bridge_token_memories) — exactly one (see assertOneTarget).
export const targetInput = z.object({
	agentId: z.uuid().optional(),
	tokenId: z.uuid().optional(),
});

export type Target = z.infer<typeof targetInput>;

export const createMemoryInput = z.object({
	name: z.string().min(1),
	description: z.string().min(1).optional(),
});

export const addItemInput = z.object({
	memoryId: z.uuid(),
	content: z.string().min(1),
	importance: z.number().min(MIN_IMPORTANCE).max(MAX_IMPORTANCE).optional(),
});

export const assignInput = targetInput.extend({
	memoryId: z.uuid(),
	role: z.enum(["read", "read_write"]).default("read"),
});

export const searchInput = targetInput.extend({
	query: z.string().min(1),
	k: z.number().int().min(1).max(MAX_SEARCH_K).default(DEFAULT_SEARCH_K),
});

// Loads a memory and asserts the caller owns it. NOT_FOUND for both missing and
// other-owner memories, so ownership never leaks.
export async function requireOwnedMemory(
	context: Context,
	userId: string,
	memoryId: string
): Promise<MemoryRow> {
	const memory = await context.services.stores.memory.get(memoryId);
	if (!memory || memory.userId !== userId) {
		throw new ORPCError("NOT_FOUND", { message: "Memory not found" });
	}
	return memory;
}

// The embedding client must be wired (a real provider is chosen post-slice; the
// server ships an inert stub whose embed() throws). null only in misconfigured
// setups — surfaced as a clear 503 rather than a nil-vector write.
export function requireEmbedding(context: Context): EmbeddingClient {
	const client = context.services.embeddingClient;
	if (!client) {
		throw new ORPCError("SERVICE_UNAVAILABLE", {
			message: "Embedding provider not configured",
		});
	}
	return client;
}

// Embed-then-persist: the single write path shared by the web router (which
// leaves `source` at its 'user' default) and the memory MCP server (which
// stamps 'extracted' for agent-authored items), so the model recorded beside
// the vector never diverges between the two entry points.
export async function embedAndAddItem(
	client: EmbeddingClient,
	store: Pick<MemoryItemStore, "add">,
	input: {
		memoryId: string;
		content: string;
		importance?: number;
		source?: MemoryItemSource;
	}
): Promise<MemoryItemRow> {
	const embedding = await client.embed(input.content);
	return store.add({
		memoryId: input.memoryId,
		content: input.content,
		embedding,
		model: client.model,
		importance: input.importance,
		source: input.source,
	});
}

// Embed-then-kNN: the single read path shared by the web router's search and
// the memory MCP server's memory_search. Skips the (paid) embedding call when
// the caller has no memories at all; hits bump last_accessed_at.
export async function embedAndSearchItems(
	client: EmbeddingClient,
	store: Pick<MemoryItemStore, "search">,
	input: { query: string; memoryIds: string[]; k: number }
): Promise<MemoryItemRow[]> {
	if (input.memoryIds.length === 0) {
		return [];
	}
	const embedding = await client.embed(input.query);
	return store.search({
		embedding,
		memoryIds: input.memoryIds,
		k: input.k,
		bumpAccessedAt: true,
	});
}

function assertOneTarget(input: Target): void {
	if (Boolean(input.agentId) === Boolean(input.tokenId)) {
		throw new ORPCError("BAD_REQUEST", {
			message: "Provide exactly one of agentId or tokenId",
		});
	}
}

async function assertOwnedAgent(
	context: Context,
	userId: string,
	agentId: string
): Promise<void> {
	const agent = await context.services.stores.agent.get(agentId);
	if (!agent || agent.userId !== userId) {
		throw new ORPCError("NOT_FOUND", { message: "Agent not found" });
	}
}

async function assertOwnedToken(
	context: Context,
	userId: string,
	tokenId: string
): Promise<void> {
	const token = await context.services.stores.bridgeToken.getById(
		tokenId,
		userId
	);
	if (!token) {
		throw new ORPCError("NOT_FOUND", { message: "Local agent not found" });
	}
}

// Asserts the caller owns the targeted agent/token, then returns its memory
// links (memoryId + role). The read path both web + MCP call through.
export async function resolveTargetLinks(
	context: Context,
	userId: string,
	input: Target
): Promise<AgentMemoryRow[]> {
	assertOneTarget(input);
	const { agentId, tokenId } = input;
	if (agentId) {
		await assertOwnedAgent(context, userId, agentId);
		return context.services.stores.memory.listAgentMemories(agentId);
	}
	if (tokenId) {
		await assertOwnedToken(context, userId, tokenId);
		return context.services.stores.memory.listTokenMemories(tokenId);
	}
	return [];
}

// Assigns (agentId) or unassigns (tokenId) a memory to/from the targeted
// agent/token, after asserting the caller owns BOTH the memory and the target.
export async function mutateAssignment(
	context: Context,
	userId: string,
	input: Target & { memoryId: string; role?: "read" | "read_write" },
	mode: "assign" | "unassign"
): Promise<void> {
	assertOneTarget(input);
	await requireOwnedMemory(context, userId, input.memoryId);
	const { memory } = context.services.stores;
	const { agentId, tokenId, memoryId, role } = input;
	if (agentId) {
		await assertOwnedAgent(context, userId, agentId);
		await (mode === "assign"
			? memory.assignAgent({ agentId, memoryId, role })
			: memory.unassignAgent(agentId, memoryId));
		return;
	}
	if (tokenId) {
		await assertOwnedToken(context, userId, tokenId);
		await (mode === "assign"
			? memory.assignToken({ tokenId, memoryId, role })
			: memory.unassignToken(tokenId, memoryId));
	}
}
