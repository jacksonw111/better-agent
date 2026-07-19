import type {
	ProjectRow,
	ProjectStore,
} from "@better-agent/agent/project-ports";
import { and, asc, desc, eq } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
// biome-ignore lint/performance/noNamespaceImport: drizzle 需要整个 schema 命名空间对象
import * as schema from "../schema";

// Driver-agnostic db type: satisfied by node-postgres (production) and PGlite (tests).
type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

// Persistence only (Q1): callers hand over secret-box ciphertext (the router
// encrypts on create and decrypts server-side only to build the one-time
// clone command) — this store never sees a plaintext token.

function toRow(row: typeof schema.projects.$inferSelect): ProjectRow {
	return {
		id: row.id,
		userId: row.userId,
		computerId: row.computerId,
		name: row.name,
		repoFullName: row.repoFullName,
		repoCloneUrl: row.repoCloneUrl,
		encryptedToken: row.encryptedToken ?? null,
		tokenLast4: row.tokenLast4 ?? null,
		status: row.status,
		errorMessage: row.errorMessage ?? null,
		localPath: row.localPath ?? null,
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
	};
}

function makeProjectReads(
	db: Db
): Pick<ProjectStore, "getById" | "listByComputer"> {
	return {
		// Owner-scoped: a Project never leaks across users.
		async getById(id, userId) {
			const rows = await db
				.select()
				.from(schema.projects)
				.where(
					and(eq(schema.projects.id, id), eq(schema.projects.userId, userId))
				)
				.limit(1);
			const row = rows[0];
			return row ? toRow(row) : null;
		},
		async listByComputer(userId, computerId) {
			const rows = await db
				.select()
				.from(schema.projects)
				.where(
					and(
						eq(schema.projects.userId, userId),
						eq(schema.projects.computerId, computerId)
					)
				)
				.orderBy(desc(schema.projects.createdAt));
			return rows.map(toRow);
		},
	};
}

// The computer-plane reads (D4): the clone queue and the ack/report lookup.
// Split from makeProjectReads to keep both under the max-lines-per-function
// gate (same shape as run-store.ts).
function makeComputerProjectReads(
	db: Db
): Pick<ProjectStore, "getByIdForComputer" | "listCreatedByComputer"> {
	return {
		// Computer-plane lookup for ackClone/reportCloneResult.
		async getByIdForComputer(id, computerId) {
			const rows = await db
				.select()
				.from(schema.projects)
				.where(
					and(
						eq(schema.projects.id, id),
						eq(schema.projects.computerId, computerId)
					)
				)
				.limit(1);
			const row = rows[0];
			return row ? toRow(row) : null;
		},
		// The Computer's clone-delivery queue (D4): still-`created` Projects,
		// oldest first. A Project leaves this queue when its ack flips it to
		// `cloning` — that is what makes redelivery idempotent.
		async listCreatedByComputer(computerId) {
			const rows = await db
				.select()
				.from(schema.projects)
				.where(
					and(
						eq(schema.projects.computerId, computerId),
						eq(schema.projects.status, "created")
					)
				)
				.orderBy(asc(schema.projects.createdAt));
			return rows.map(toRow);
		},
	};
}

// The user-plane edit (projects.update / projects.retryClone). Kept out of
// makeProjectWrites for the max-lines-per-function gate, like the read split.
function makeProjectEdit(db: Db): Pick<ProjectStore, "update"> {
	return {
		// Owner-scoped partial edit: drizzle skips undefined values in `set`, so
		// omitted fields keep their values. Returns the updated row (the router
		// answers with it), or null when the row isn't the caller's.
		async update(id, userId, update) {
			const rows = await db
				.update(schema.projects)
				.set({ ...update, updatedAt: new Date() })
				.where(
					and(eq(schema.projects.id, id), eq(schema.projects.userId, userId))
				)
				.returning();
			const row = rows[0];
			return row ? toRow(row) : null;
		},
	};
}

function makeProjectWrites(
	db: Db
): Pick<ProjectStore, "insert" | "updateStatus" | "delete"> {
	return {
		async insert(input) {
			const rows = await db.insert(schema.projects).values(input).returning();
			const row = rows[0];
			if (!row) {
				throw new Error("Failed to insert project");
			}
			return toRow(row);
		},
		// Partial update: drizzle skips undefined values in `set`, so omitted
		// fields (localPath / errorMessage) keep their values.
		async updateStatus(id, update) {
			const rows = await db
				.update(schema.projects)
				.set({ ...update, updatedAt: new Date() })
				.where(eq(schema.projects.id, id))
				.returning({ id: schema.projects.id });
			return rows.length > 0;
		},
		// Owner-scoped. Deletes the DB row ONLY — the checkout directory on the
		// Computer is the user's local data and is never removed by the server.
		// Sessions that used the project are detached (project_id → null) first:
		// tasks.project_id has no ON DELETE action, so the delete would otherwise
		// hit the FK, and the chat history should outlive the project anyway.
		async delete(id, userId) {
			return await db.transaction(async (tx) => {
				const owned = await tx
					.select({ id: schema.projects.id })
					.from(schema.projects)
					.where(
						and(eq(schema.projects.id, id), eq(schema.projects.userId, userId))
					);
				if (owned.length === 0) {
					return false;
				}
				await tx
					.update(schema.tasks)
					.set({ projectId: null })
					.where(eq(schema.tasks.projectId, id));
				const rows = await tx
					.delete(schema.projects)
					.where(eq(schema.projects.id, id))
					.returning({ id: schema.projects.id });
				return rows.length > 0;
			});
		},
	};
}

export function createProjectStore(db: Db): ProjectStore {
	return {
		...makeProjectReads(db),
		...makeComputerProjectReads(db),
		...makeProjectEdit(db),
		...makeProjectWrites(db),
	};
}
