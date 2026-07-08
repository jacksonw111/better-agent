// Memory-system port types (M1), split out of ports.ts so that file stays
// under the repo's 300-line limit. Self-contained (no imports back into
// ports.ts) to avoid a circular type-only dependency; ports.ts re-exports these.
//
// A `memory` is a named, ownable, shareable knowledge base. `agent_memories`
// links agents to memories many-to-many with a per-link role. `memory_items`
// are the atomic, retrievable facts; each item may carry one embedding row
// (persisted separately so re-embedding never rewrites the facts). Owner/authz
// scoping is enforced at the API layer — these stores take ids.

/** Whether a linked agent may only read a memory or also write to it. */
export type MemoryRole = "read" | "read_write";

/** How a memory item came to be. M1 only writes `user`; the rest are for the
 * later auto-capture / reflection phases. */
export type MemoryItemSource = "user" | "extracted" | "reflection";

/** A named, ownable, shareable knowledge base. */
export interface MemoryRow {
	createdAt: Date;
	description: string | null;
	id: string;
	name: string;
	updatedAt: Date;
	userId: string;
}

/** A memory link (agent↔memory or bridge-token↔memory) with its access role. */
export interface AgentMemoryRow {
	memoryId: string;
	role: MemoryRole;
}

/** Produces a fixed-width embedding vector for a text. Current provider is
 * SiliconFlow's `BAAI/bge-m3` (1024 dims) via an external API — NOT the on-edge
 * Workers AI path decision D1 originally envisioned. `model` names the producing
 * model so it can be persisted alongside the vector for later re-embedding /
 * A-B tests. */
export interface EmbeddingClient {
	embed(text: string): Promise<number[]>;
	readonly model: string;
}

/** An atomic, retrievable fact. `validTo` null = current (soft-delete sets it). */
export interface MemoryItemRow {
	content: string;
	createdAt: Date;
	id: string;
	importance: number;
	lastAccessedAt: Date | null;
	memoryId: string;
	metadata: Record<string, unknown> | null;
	source: MemoryItemSource;
	updatedAt: Date;
	validFrom: Date;
	validTo: Date | null;
}

export interface MemoryStore {
	/** Links a memory to an agent (or updates the role if already linked). */
	assignAgent(input: {
		agentId: string;
		memoryId: string;
		role?: MemoryRole;
	}): Promise<void>;
	/** Links a memory to a local/bridge agent (or updates the role). */
	assignToken(input: {
		tokenId: string;
		memoryId: string;
		role?: MemoryRole;
	}): Promise<void>;
	create(input: {
		userId: string;
		name: string;
		description?: string;
	}): Promise<MemoryRow>;
	/** Owner-scoped delete: only removes the row when it belongs to `userId`. */
	delete(id: string, userId: string): Promise<void>;
	/** Owner-scoped cascade delete: removes the memory plus its items,
	 * embeddings and agent/token links in one transaction. No-op if not owned. */
	deleteWithChildren(id: string, userId: string): Promise<void>;
	get(id: string): Promise<MemoryRow | null>;
	/** Batch fetch: the memories for the given ids in one query (order and
	 * completeness not guaranteed — missing ids are simply absent). */
	getMany(ids: string[]): Promise<MemoryRow[]>;
	/** The memory ids (+role) assigned to an agent. */
	listAgentMemories(agentId: string): Promise<AgentMemoryRow[]>;
	listByUser(userId: string): Promise<MemoryRow[]>;
	/** The memory ids (+role) assigned to a local/bridge agent. */
	listTokenMemories(tokenId: string): Promise<AgentMemoryRow[]>;
	unassignAgent(agentId: string, memoryId: string): Promise<void>;
	unassignToken(tokenId: string, memoryId: string): Promise<void>;
}

export interface MemoryItemStore {
	/** Persists a fact plus its (externally produced) embedding vector + model. */
	add(input: {
		memoryId: string;
		content: string;
		embedding: number[];
		model: string;
		source?: MemoryItemSource;
		importance?: number;
		metadata?: Record<string, unknown>;
	}): Promise<MemoryItemRow>;
	/** A single item by id (regardless of valid_to), or null. Used to resolve
	 * the owning memory for owner-scoped mutations. */
	get(id: string): Promise<MemoryItemRow | null>;
	/** Current (valid_to IS NULL) items of a memory, newest first. */
	listCurrent(memoryId: string): Promise<MemoryItemRow[]>;
	/** kNN over the given memories: top-k current items by cosine distance to
	 * `embedding`. Optionally bumps `lastAccessedAt` on the returned items. */
	search(input: {
		embedding: number[];
		memoryIds: string[];
		k: number;
		bumpAccessedAt?: boolean;
	}): Promise<MemoryItemRow[]>;
	/** Soft-delete: sets `validTo` so the item drops out of the current set. */
	softDelete(id: string): Promise<void>;
}
