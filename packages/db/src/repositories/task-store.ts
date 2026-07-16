import type { TaskRow, TaskStore } from "@better-agent/agent/task-ports";
import { and, desc, eq } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
// biome-ignore lint/performance/noNamespaceImport: drizzle 需要整个 schema 命名空间对象
import * as schema from "../schema";

// Driver-agnostic db type: satisfied by node-postgres (production) and PGlite (tests).
type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

function toRow(row: typeof schema.tasks.$inferSelect): TaskRow {
	return {
		id: row.id,
		userId: row.userId,
		name: row.name,
		description: row.description,
		status: row.status,
		computerId: row.computerId,
		agentKind: row.agentKind,
		repositoryFullName: row.repositoryFullName ?? null,
		repositoryUrl: row.repositoryUrl ?? null,
		openingMessage: row.openingMessage,
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
	};
}

export function createTaskStore(db: Db): TaskStore {
	return {
		async insert(input) {
			const rows = await db.insert(schema.tasks).values(input).returning();
			const row = rows[0];
			if (!row) {
				throw new Error("Failed to insert task");
			}
			return toRow(row);
		},
		// Owner-scoped everywhere below: a Task never leaks across users.
		async getById(id, userId) {
			const rows = await db
				.select()
				.from(schema.tasks)
				.where(and(eq(schema.tasks.id, id), eq(schema.tasks.userId, userId)))
				.limit(1);
			const row = rows[0];
			return row ? toRow(row) : null;
		},
		async listByUser(userId) {
			const rows = await db
				.select()
				.from(schema.tasks)
				.where(eq(schema.tasks.userId, userId))
				.orderBy(desc(schema.tasks.createdAt));
			return rows.map(toRow);
		},
		async updateStatus(id, userId, status) {
			const rows = await db
				.update(schema.tasks)
				.set({ status, updatedAt: new Date() })
				.where(and(eq(schema.tasks.id, id), eq(schema.tasks.userId, userId)))
				.returning({ id: schema.tasks.id });
			return rows.length > 0;
		},
	};
}
