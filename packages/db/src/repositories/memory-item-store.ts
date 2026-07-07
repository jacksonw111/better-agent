import type { MemoryItemRow, MemoryItemStore } from "@better-agent/agent/ports";
import { and, cosineDistance, eq, inArray, isNull, sql } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
// biome-ignore lint/performance/noNamespaceImport: drizzle 需要整个 schema 命名空间对象
import * as schema from "../schema";

// Driver-agnostic db type: satisfied by node-postgres (production) and PGlite (tests).
type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

function toRow(row: typeof schema.memoryItems.$inferSelect): MemoryItemRow {
	return {
		id: row.id,
		memoryId: row.memoryId,
		content: row.content,
		source: row.source,
		importance: row.importance,
		validFrom: row.validFrom,
		validTo: row.validTo ?? null,
		lastAccessedAt: row.lastAccessedAt ?? null,
		metadata: row.metadata ?? null,
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
	};
}

// Persist the fact then its embedding in one transaction: an item is never
// visible to kNN without its vector, and a stray vector never outlives a failed
// item insert.
async function addItem(
	db: Db,
	input: {
		memoryId: string;
		content: string;
		embedding: number[];
		model: string;
		source?: "user" | "extracted" | "reflection";
		importance?: number;
		metadata?: Record<string, unknown>;
	}
): Promise<MemoryItemRow> {
	return await db.transaction(async (tx) => {
		const rows = await tx
			.insert(schema.memoryItems)
			.values({
				memoryId: input.memoryId,
				content: input.content,
				source: input.source,
				importance: input.importance,
				metadata: input.metadata,
			})
			.returning();
		const row = rows[0];
		if (!row) {
			throw new Error("Failed to create memory item");
		}
		await tx.insert(schema.memoryEmbeddings).values({
			itemId: row.id,
			embedding: input.embedding,
			model: input.model,
		});
		return toRow(row);
	});
}

// kNN over the current items of the given memories, ordered by cosine distance
// (`embedding <=> $query`) so the HNSW `vector_cosine_ops` index is used.
async function searchItems(
	db: Db,
	input: {
		embedding: number[];
		memoryIds: string[];
		k: number;
		bumpAccessedAt?: boolean;
	}
): Promise<MemoryItemRow[]> {
	if (input.memoryIds.length === 0 || input.k <= 0) {
		return [];
	}
	const distance = cosineDistance(
		schema.memoryEmbeddings.embedding,
		input.embedding
	);
	const rows = await db
		.select({ item: schema.memoryItems })
		.from(schema.memoryItems)
		.innerJoin(
			schema.memoryEmbeddings,
			eq(schema.memoryEmbeddings.itemId, schema.memoryItems.id)
		)
		.where(
			and(
				inArray(schema.memoryItems.memoryId, input.memoryIds),
				isNull(schema.memoryItems.validTo)
			)
		)
		.orderBy(distance)
		.limit(input.k);
	const items = rows.map((row) => toRow(row.item));
	if (input.bumpAccessedAt && items.length > 0) {
		await db
			.update(schema.memoryItems)
			.set({ lastAccessedAt: sql`now()` })
			.where(
				inArray(
					schema.memoryItems.id,
					items.map((item) => item.id)
				)
			);
	}
	return items;
}

export function createMemoryItemStore(db: Db): MemoryItemStore {
	return {
		add: (input) => addItem(db, input),
		async get(id) {
			const rows = await db
				.select()
				.from(schema.memoryItems)
				.where(eq(schema.memoryItems.id, id))
				.limit(1);
			const row = rows[0];
			return row ? toRow(row) : null;
		},
		async listCurrent(memoryId) {
			const rows = await db
				.select()
				.from(schema.memoryItems)
				.where(
					and(
						eq(schema.memoryItems.memoryId, memoryId),
						isNull(schema.memoryItems.validTo)
					)
				)
				.orderBy(sql`${schema.memoryItems.createdAt} DESC`);
			return rows.map(toRow);
		},
		async softDelete(id) {
			await db
				.update(schema.memoryItems)
				.set({ validTo: sql`now()`, updatedAt: sql`now()` })
				.where(eq(schema.memoryItems.id, id));
		},
		search: (input) => searchItems(db, input),
	};
}
