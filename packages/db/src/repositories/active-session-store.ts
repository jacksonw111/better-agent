import type {
	ActiveSessionRow,
	ActiveSessionStore,
} from "@better-agent/agent/task/active-session-ports";
import { TERMINAL_RUN_STATUSES } from "@better-agent/agent/task-ports";
import { desc, eq } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
// biome-ignore lint/performance/noNamespaceImport: drizzle 需要整个 schema 命名空间对象
import * as schema from "../schema";

// Driver-agnostic db type: satisfied by node-postgres (production) and PGlite (tests).
type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

// The global active-session view's read (see
// @better-agent/agent/task/active-session-ports). ONE statement: DISTINCT ON
// (task_id) ordered by created_at DESC picks each Task's latest Run, and the
// joins pull the computer / project / bridge-session context along with it.
// The web polls this every ~10s, so a per-task follow-up read for any of those
// three would be the N+1 this port exists to avoid.

/** Why the terminal filter is applied in JS and not in the WHERE clause: the
 * predicate is "the LATEST run is non-terminal", and a WHERE on `runs.status`
 * runs BEFORE DISTINCT ON picks that latest row — it would resurrect an old
 * stuck `running` sibling under a task that has since completed. Expressing it
 * in SQL therefore needs a wrapping subquery; the row count here is bounded by
 * the user's task count, so filtering after the fetch is both correct and
 * cheap. */
function isActive(status: ActiveSessionRow["runStatus"]): boolean {
	return !TERMINAL_RUN_STATUSES.has(status);
}

export function createActiveSessionStore(db: Db): ActiveSessionStore {
	return {
		async listActiveByUser(userId) {
			const rows = await db
				.selectDistinctOn([schema.runs.taskId], {
					agentKind: schema.runs.agentKind,
					computerId: schema.runs.computerId,
					computerLastSeenAt: schema.computers.lastSeenAt,
					computerName: schema.computers.name,
					projectId: schema.tasks.projectId,
					projectName: schema.projects.name,
					runId: schema.runs.id,
					runStatus: schema.runs.status,
					sessionId: schema.runs.sessionId,
					sessionLastSeenAt: schema.bridgeSessions.lastSeenAt,
					sessionStatus: schema.bridgeSessions.status,
					taskId: schema.runs.taskId,
					taskName: schema.tasks.name,
					updatedAt: schema.runs.updatedAt,
				})
				.from(schema.runs)
				.innerJoin(schema.tasks, eq(schema.runs.taskId, schema.tasks.id))
				.innerJoin(
					schema.computers,
					eq(schema.runs.computerId, schema.computers.id)
				)
				// Left joins: a Task need not have a Project, a Run need not have a
				// bound session yet — and a hard-deleted session leaves a dangling
				// binding, which must still surface (as a dead reporter) rather than
				// dropping the row.
				.leftJoin(
					schema.projects,
					eq(schema.tasks.projectId, schema.projects.id)
				)
				.leftJoin(
					schema.bridgeSessions,
					eq(schema.runs.sessionId, schema.bridgeSessions.id)
				)
				.where(eq(schema.tasks.userId, userId))
				// DISTINCT ON requires the leading ORDER BY term to match it; the
				// created_at DESC tie-break is what makes the kept row the latest.
				.orderBy(schema.runs.taskId, desc(schema.runs.createdAt));
			return rows.filter((row) => isActive(row.runStatus));
		},
	};
}
