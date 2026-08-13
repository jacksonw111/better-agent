import type {
	AgentMemoryRow,
	EmbeddingClient,
	MemoryItemRow,
	MemoryItemSource,
	MemoryItemStore,
	MemoryRow,
} from "@better-agent/agent/ports";
import { ORPCError } from "@orpc/server";
import { log } from "evlog";
import { z } from "zod";
import type { Context } from "../context";

// Shared input schemas + ownership/target-resolution helpers for the memory
// router, split out so memory.ts stays under the per-file line cap.

export const DEFAULT_SEARCH_K = 5;
const MAX_SEARCH_K = 50;
const MIN_IMPORTANCE = 0;
const MAX_IMPORTANCE = 1;
// Upper bound on text handed to the (paid, third-party) embedding API. Caps
// cost/DoS from an oversized item or query — enforced at the shared embed
// chokepoint so both the web router and the MCP tools are covered.
const MAX_EMBED_CHARS = 8000;

export const idInput = z.object({ id: z.uuid() });
export const memoryIdInput = z.object({ memoryId: z.uuid() });
export const itemIdInput = z.object({ itemId: z.uuid() });

// A memory is assigned to a web agent (agentId → agent_memories).
export const targetInput = z.object({
	agentId: z.uuid(),
});

export type Target = z.infer<typeof targetInput>;

export const createMemoryInput = z.object({
	name: z.string().min(1),
	description: z.string().min(1).optional(),
});

export const addItemInput = z.object({
	memoryId: z.uuid(),
	content: z.string().min(1).max(MAX_EMBED_CHARS),
	importance: z.number().min(MIN_IMPORTANCE).max(MAX_IMPORTANCE).optional(),
});

export const assignInput = targetInput.extend({
	memoryId: z.uuid(),
	role: z.enum(["read", "read_write"]).default("read"),
});

export const searchInput = targetInput.extend({
	query: z.string().min(1).max(MAX_EMBED_CHARS),
	k: z.number().int().min(1).max(MAX_SEARCH_K).default(DEFAULT_SEARCH_K),
});

// Guards the shared embed paths (below) — the web router already validates via
// the zod schemas above, but the MCP tools call embedAndAddItem/SearchItems
// directly with raw agent input, so the cap must live here too.
function assertEmbedTextWithinLimit(text: string): void {
	if (text.length > MAX_EMBED_CHARS) {
		throw new ORPCError("BAD_REQUEST", {
			message: `Text exceeds the ${MAX_EMBED_CHARS}-character embedding limit`,
		});
	}
}

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

// Runs the (paid, third-party) embedding call at the shared chokepoint both the
// web router and the MCP tools flow through. embed() rejects with a PLAIN Error
// on misconfiguration (missing API key) or upstream failure (4xx/5xx/network);
// that raw text can carry provider internals, so we log it server-side for
// operators and re-throw a SANITIZED SERVICE_UNAVAILABLE — never echoing the
// upstream message to the caller. An ORPCError (e.g. the char-limit guard) is
// already sanitized, so it passes through untouched.
async function embedText(
	client: EmbeddingClient,
	text: string
): Promise<number[]> {
	try {
		return await client.embed(text);
	} catch (error) {
		if (error instanceof ORPCError) {
			throw error;
		}
		log.error(
			"memory",
			`embedding provider failed: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`
		);
		throw new ORPCError("SERVICE_UNAVAILABLE", {
			message: "Embedding provider is unavailable",
		});
	}
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
	assertEmbedTextWithinLimit(input.content);
	const embedding = await embedText(client, input.content);
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
	assertEmbedTextWithinLimit(input.query);
	const embedding = await embedText(client, input.query);
	return store.search({
		embedding,
		memoryIds: input.memoryIds,
		k: input.k,
		bumpAccessedAt: true,
	});
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

// Asserts the caller owns the targeted agent, then returns its memory links
// (memoryId + role). The read path both web + MCP call through.
export async function resolveTargetLinks(
	context: Context,
	userId: string,
	input: Target
): Promise<AgentMemoryRow[]> {
	await assertOwnedAgent(context, userId, input.agentId);
	return context.services.stores.memory.listAgentMemories(input.agentId);
}

// Assigns or unassigns a memory to/from the targeted agent, after asserting
// the caller owns BOTH the memory and the target.
export async function mutateAssignment(
	context: Context,
	userId: string,
	input: Target & { memoryId: string; role?: "read" | "read_write" },
	mode: "assign" | "unassign"
): Promise<void> {
	await requireOwnedMemory(context, userId, input.memoryId);
	const { agentId, memoryId, role } = input;
	await assertOwnedAgent(context, userId, agentId);
	await (mode === "assign"
		? context.services.stores.memory.assignAgent({ agentId, memoryId, role })
		: context.services.stores.memory.unassignAgent(agentId, memoryId));
}
