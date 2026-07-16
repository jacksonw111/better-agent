import { and, count, desc, eq, ilike } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
// biome-ignore lint/performance/noNamespaceImport: drizzle 需要整个 schema 命名空间对象
import * as schema from "../schema";

// Driver-agnostic db type: satisfied by node-postgres (production) and PGlite (tests).
type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

/** Knowledge document metadata row, including the server-internal object
 * storage key and in-flight multipart upload id. */
export type KnowledgeDocumentMeta =
	typeof schema.knowledgeDocuments.$inferSelect;

// Escape LIKE wildcards so a search for "50%" matches the literal string, not
// everything starting with "50".
const LIKE_SPECIALS = /[%_\\]/g;

function likePattern(search: string): string {
	return `%${search.replace(LIKE_SPECIALS, "\\$&")}%`;
}

export interface KnowledgeDocumentMetaStore {
	delete(id: string): Promise<void>;
	/** The interrupted upload a re-selected file resumes: same owner, name and
	 * size, still in `uploading`. */
	findPendingUpload(input: {
		name: string;
		ownerId: string;
		size: number;
	}): Promise<KnowledgeDocumentMeta | null>;
	getByIdForOwner(
		ownerId: string,
		id: string
	): Promise<KnowledgeDocumentMeta | null>;
	insert(input: {
		mime: string;
		name: string;
		ownerId: string;
		partSize: number;
		r2Key: string;
		size: number;
		uploadId: string;
	}): Promise<KnowledgeDocumentMeta>;
	/** Ready documents only, newest first, optional case-insensitive name
	 * search. */
	listByOwner(input: {
		limit: number;
		offset: number;
		ownerId: string;
		search?: string;
	}): Promise<{ items: KnowledgeDocumentMeta[]; total: number }>;
	markReady(id: string): Promise<KnowledgeDocumentMeta | null>;
}

// The lookup ops, split into their own factory so createKnowledgeDocumentStore
// stays under the repo's max-lines-per-function gate.
function makeReadOps(
	db: Db
): Pick<KnowledgeDocumentMetaStore, "findPendingUpload" | "getByIdForOwner"> {
	const table = schema.knowledgeDocuments;
	return {
		async getByIdForOwner(ownerId, id) {
			const rows = await db
				.select()
				.from(table)
				.where(and(eq(table.id, id), eq(table.ownerId, ownerId)))
				.limit(1);
			return rows[0] ?? null;
		},
		async findPendingUpload(input) {
			const rows = await db
				.select()
				.from(table)
				.where(
					and(
						eq(table.ownerId, input.ownerId),
						eq(table.name, input.name),
						eq(table.size, input.size),
						eq(table.status, "uploading")
					)
				)
				.orderBy(desc(table.createdAt))
				.limit(1);
			return rows[0] ?? null;
		},
	};
}

export function createKnowledgeDocumentStore(
	db: Db
): KnowledgeDocumentMetaStore {
	const table = schema.knowledgeDocuments;
	return {
		...makeReadOps(db),
		async insert(input) {
			const rows = await db.insert(table).values(input).returning();
			const row = rows[0];
			if (!row) {
				throw new Error("Failed to insert knowledge document");
			}
			return row;
		},
		async listByOwner(input) {
			const where = and(
				eq(table.ownerId, input.ownerId),
				eq(table.status, "ready"),
				input.search ? ilike(table.name, likePattern(input.search)) : undefined
			);
			const [items, totals] = await Promise.all([
				db
					.select()
					.from(table)
					.where(where)
					.orderBy(desc(table.createdAt))
					.limit(input.limit)
					.offset(input.offset),
				db.select({ total: count() }).from(table).where(where),
			]);
			return { items, total: totals[0]?.total ?? 0 };
		},
		async markReady(id) {
			const rows = await db
				.update(table)
				.set({ status: "ready", uploadId: null, updatedAt: new Date() })
				.where(eq(table.id, id))
				.returning();
			return rows[0] ?? null;
		},
		async delete(id) {
			await db.delete(table).where(eq(table.id, id));
		},
	};
}
