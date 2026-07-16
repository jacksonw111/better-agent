import type { RunRow, RunStore } from "@better-agent/agent/task-ports";
import { asc, desc, eq } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
// biome-ignore lint/performance/noNamespaceImport: drizzle 需要整个 schema 命名空间对象
import * as schema from "../schema";

// Driver-agnostic db type: satisfied by node-postgres (production) and PGlite (tests).
type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

function toRow(row: typeof schema.runs.$inferSelect): RunRow {
	return {
		id: row.id,
		taskId: row.taskId,
		computerId: row.computerId,
		agentKind: row.agentKind,
		status: row.status,
		launchKey: row.launchKey,
		workspaceKind: row.workspaceKind,
		workspacePath: row.workspacePath ?? null,
		branch: row.branch ?? null,
		issueSnapshots: row.issueSnapshots,
		sessionId: row.sessionId ?? null,
		errorMessage: row.errorMessage ?? null,
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
	};
}

function makeRunReads(
	db: Db
): Pick<
	RunStore,
	"getById" | "getByLaunchKey" | "listByTask" | "latestByTask"
> {
	return {
		async getById(id) {
			const rows = await db
				.select()
				.from(schema.runs)
				.where(eq(schema.runs.id, id))
				.limit(1);
			const row = rows[0];
			return row ? toRow(row) : null;
		},
		// launchKey is the Launch Command idempotency key (unique, = run id).
		async getByLaunchKey(launchKey) {
			const rows = await db
				.select()
				.from(schema.runs)
				.where(eq(schema.runs.launchKey, launchKey))
				.limit(1);
			const row = rows[0];
			return row ? toRow(row) : null;
		},
		// Chronological — Runs are sequential per Task (retry appends).
		async listByTask(taskId) {
			const rows = await db
				.select()
				.from(schema.runs)
				.where(eq(schema.runs.taskId, taskId))
				.orderBy(asc(schema.runs.createdAt));
			return rows.map(toRow);
		},
		async latestByTask(taskId) {
			const rows = await db
				.select()
				.from(schema.runs)
				.where(eq(schema.runs.taskId, taskId))
				.orderBy(desc(schema.runs.createdAt))
				.limit(1);
			const row = rows[0];
			return row ? toRow(row) : null;
		},
	};
}

function makeRunWrites(db: Db): Pick<RunStore, "insert" | "updateStatus"> {
	return {
		async insert(input) {
			const rows = await db.insert(schema.runs).values(input).returning();
			const row = rows[0];
			if (!row) {
				throw new Error("Failed to insert run");
			}
			return toRow(row);
		},
		// Partial update: drizzle skips undefined values in `set`, so omitted
		// fields (workspacePath / sessionId / errorMessage) keep their values.
		async updateStatus(id, update) {
			const rows = await db
				.update(schema.runs)
				.set({ ...update, updatedAt: new Date() })
				.where(eq(schema.runs.id, id))
				.returning({ id: schema.runs.id });
			return rows.length > 0;
		},
	};
}

export function createRunStore(db: Db): RunStore {
	return {
		...makeRunReads(db),
		...makeRunWrites(db),
	};
}
