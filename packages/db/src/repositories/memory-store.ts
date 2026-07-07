import type { MemoryRow, MemoryStore } from "@better-agent/agent/ports";
import { and, eq } from "drizzle-orm";
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

export function createMemoryStore(db: Db): MemoryStore {
	return {
		...makeAgentLinkOps(db),
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
