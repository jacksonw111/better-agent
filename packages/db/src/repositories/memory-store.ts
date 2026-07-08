import type { MemoryRow, MemoryStore } from "@better-agent/agent/ports";
import { and, eq, inArray } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
// biome-ignore lint/performance/noNamespaceImport: drizzle 需要整个 schema 命名空间对象
import * as schema from "../schema";

// Driver-agnostic db type: satisfied by node-postgres (production) and PGlite (tests).
type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

function toRow(row: typeof schema.memories.$inferSelect): MemoryRow {
	return {
		id: row.id,
		userId: row.userId,
		name: row.name,
		description: row.description ?? null,
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
	};
}

// The agent↔memory link ops, split into their own factory so createMemoryStore
// stays under the repo's max-lines-per-function gate.
function makeAgentLinkOps(
	db: Db
): Pick<MemoryStore, "assignAgent" | "unassignAgent" | "listAgentMemories"> {
	return {
		async assignAgent({ agentId, memoryId, role = "read" }) {
			await db
				.insert(schema.agentMemories)
				.values({ agentId, memoryId, role })
				.onConflictDoUpdate({
					target: [schema.agentMemories.agentId, schema.agentMemories.memoryId],
					set: { role },
				});
		},
		async unassignAgent(agentId, memoryId) {
			await db
				.delete(schema.agentMemories)
				.where(
					and(
						eq(schema.agentMemories.agentId, agentId),
						eq(schema.agentMemories.memoryId, memoryId)
					)
				);
		},
		async listAgentMemories(agentId) {
			const rows = await db
				.select({
					memoryId: schema.agentMemories.memoryId,
					role: schema.agentMemories.role,
				})
				.from(schema.agentMemories)
				.where(eq(schema.agentMemories.agentId, agentId));
			return rows.map((row) => ({ memoryId: row.memoryId, role: row.role }));
		},
	};
}

// The bridge-token↔memory link ops (local agents), mirroring the agent link
// ops in their own factory so createMemoryStore stays under the max-lines gate.
function makeTokenLinkOps(
	db: Db
): Pick<MemoryStore, "assignToken" | "unassignToken" | "listTokenMemories"> {
	return {
		async assignToken({ tokenId, memoryId, role = "read" }) {
			await db
				.insert(schema.bridgeTokenMemories)
				.values({ tokenId, memoryId, role })
				.onConflictDoUpdate({
					target: [
						schema.bridgeTokenMemories.tokenId,
						schema.bridgeTokenMemories.memoryId,
					],
					set: { role },
				});
		},
		async unassignToken(tokenId, memoryId) {
			await db
				.delete(schema.bridgeTokenMemories)
				.where(
					and(
						eq(schema.bridgeTokenMemories.tokenId, tokenId),
						eq(schema.bridgeTokenMemories.memoryId, memoryId)
					)
				);
		},
		async listTokenMemories(tokenId) {
			const rows = await db
				.select({
					memoryId: schema.bridgeTokenMemories.memoryId,
					role: schema.bridgeTokenMemories.role,
				})
				.from(schema.bridgeTokenMemories)
				.where(eq(schema.bridgeTokenMemories.tokenId, tokenId));
			return rows.map((row) => ({ memoryId: row.memoryId, role: row.role }));
		},
	};
}

// Owner-scoped cascade delete in one transaction: FKs are ON DELETE no action
// (matching the repo convention), so children are removed explicitly, innermost
// first (embeddings → items → links → memory). The final memory delete is
// owner-scoped, so a non-owner's call removes nothing.
async function deleteMemoryWithChildren(
	db: Db,
	id: string,
	userId: string
): Promise<void> {
	await db.transaction(async (tx) => {
		const items = await tx
			.select({ id: schema.memoryItems.id })
			.from(schema.memoryItems)
			.where(eq(schema.memoryItems.memoryId, id));
		const itemIds = items.map((item) => item.id);
		if (itemIds.length > 0) {
			await tx
				.delete(schema.memoryEmbeddings)
				.where(inArray(schema.memoryEmbeddings.itemId, itemIds));
		}
		await tx
			.delete(schema.memoryItems)
			.where(eq(schema.memoryItems.memoryId, id));
		await tx
			.delete(schema.agentMemories)
			.where(eq(schema.agentMemories.memoryId, id));
		await tx
			.delete(schema.bridgeTokenMemories)
			.where(eq(schema.bridgeTokenMemories.memoryId, id));
		await tx
			.delete(schema.memories)
			.where(
				and(eq(schema.memories.id, id), eq(schema.memories.userId, userId))
			);
	});
}

function selectMemoriesByIds(db: Db, ids: string[]): Promise<MemoryRow[]> {
	if (ids.length === 0) {
		return Promise.resolve([]);
	}
	return db
		.select()
		.from(schema.memories)
		.where(inArray(schema.memories.id, ids))
		.then((rows) => rows.map(toRow));
}

export function createMemoryStore(db: Db): MemoryStore {
	return {
		...makeAgentLinkOps(db),
		...makeTokenLinkOps(db),
		deleteWithChildren: (id, userId) =>
			deleteMemoryWithChildren(db, id, userId),
		async create({ userId, name, description }) {
			const rows = await db
				.insert(schema.memories)
				.values({ userId, name, description })
				.returning();
			const row = rows[0];
			if (!row) {
				throw new Error("Failed to create memory");
			}
			return toRow(row);
		},
		async get(id) {
			const rows = await db
				.select()
				.from(schema.memories)
				.where(eq(schema.memories.id, id))
				.limit(1);
			const row = rows[0];
			return row ? toRow(row) : null;
		},
		getMany: (ids) => selectMemoriesByIds(db, ids),
		async listByUser(userId) {
			const rows = await db
				.select()
				.from(schema.memories)
				.where(eq(schema.memories.userId, userId));
			return rows.map(toRow);
		},
		async delete(id, userId) {
			await db
				.delete(schema.memories)
				.where(
					and(eq(schema.memories.id, id), eq(schema.memories.userId, userId))
				);
		},
	};
}
