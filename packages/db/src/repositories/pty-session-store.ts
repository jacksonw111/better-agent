import type {
	PtySessionRow,
	PtySessionStore,
} from "@better-agent/agent/pty-session-ports";
import { and, desc, eq, lt, notInArray } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
// biome-ignore lint/performance/noNamespaceImport: drizzle 需要整个 schema 命名空间对象
import * as schema from "../schema";

// Persistence only (P25-A, DP-S1): the stable-id registry that lets a terminal
// survive viewer detach and CLI reconnect. Rows are created before any pty
// exists and only ever leave `active` via markEnded / endStaleExcept.

// Grace so a session created-but-not-yet-opened (no pty, so absent from a
// reconnecting CLI's live set) isn't wrongly reconciled to `ended`.
const DEFAULT_STALE_GRACE_MS = 30_000;

type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

function toRow(row: typeof schema.ptySessions.$inferSelect): PtySessionRow {
	return {
		id: row.id,
		userId: row.userId,
		computerId: row.computerId,
		projectId: row.projectId ?? null,
		agentKind: row.agentKind,
		agentSessionId: row.agentSessionId ?? null,
		agentSessionStarted: row.agentSessionStarted,
		activityState: row.activityState ?? null,
		activityStateAt: row.activityStateAt ?? null,
		title: row.title,
		status: row.status,
		createdAt: row.createdAt,
		lastActivityAt: row.lastActivityAt,
	};
}

type Filter = ReturnType<typeof eq>;

// Shared active-list query: filter, order by freshest activity, map to rows.
async function selectActiveOrdered(
	db: Db,
	filters: Filter[]
): Promise<PtySessionRow[]> {
	const rows = await db
		.select()
		.from(schema.ptySessions)
		.where(and(...filters))
		.orderBy(desc(schema.ptySessions.lastActivityAt));
	return rows.map(toRow);
}

function makeReads(
	db: Db
): Pick<
	PtySessionStore,
	"getById" | "listActiveByComputer" | "listActiveByUser"
> {
	return {
		async getById(id, userId) {
			const rows = await db
				.select()
				.from(schema.ptySessions)
				.where(
					and(
						eq(schema.ptySessions.id, id),
						eq(schema.ptySessions.userId, userId)
					)
				)
				.limit(1);
			const row = rows[0];
			return row ? toRow(row) : null;
		},
		listActiveByComputer(userId, computerId, projectId) {
			const filters = [
				eq(schema.ptySessions.userId, userId),
				eq(schema.ptySessions.computerId, computerId),
				eq(schema.ptySessions.status, "active"),
			];
			if (projectId) {
				filters.push(eq(schema.ptySessions.projectId, projectId));
			}
			return selectActiveOrdered(db, filters);
		},
		listActiveByUser(userId) {
			return selectActiveOrdered(db, [
				eq(schema.ptySessions.userId, userId),
				eq(schema.ptySessions.status, "active"),
			]);
		},
	};
}

function makeCreate(db: Db): Pick<PtySessionStore, "create"> {
	return {
		async create(input) {
			const rows = await db
				.insert(schema.ptySessions)
				.values({
					userId: input.userId,
					computerId: input.computerId,
					projectId: input.projectId,
					agentKind: input.agentKind,
					title: input.title,
				})
				.returning();
			const row = rows[0];
			if (!row) {
				throw new Error("Failed to create pty session");
			}
			return toRow(row);
		},
	};
}

function makeActivity(db: Db): Pick<PtySessionStore, "setActivityState"> {
	return {
		// Observability slice A: idempotent, keyed by id alone (the CLI is trusted).
		// The state string is stored verbatim — trimming/empty-dropping is the
		// caller's job, and unknown values are accepted (version-tolerant).
		async setActivityState(id, state, at) {
			await db
				.update(schema.ptySessions)
				.set({ activityState: state, activityStateAt: at })
				.where(eq(schema.ptySessions.id, id));
		},
	};
}

function makeBinding(
	db: Db
): Pick<PtySessionStore, "setAgentSession" | "markStarted"> {
	return {
		async setAgentSession(id, agentSessionId) {
			await db
				.update(schema.ptySessions)
				.set({ agentSessionId, agentSessionStarted: true })
				.where(eq(schema.ptySessions.id, id));
		},
		async markStarted(id) {
			await db
				.update(schema.ptySessions)
				.set({ agentSessionStarted: true })
				.where(eq(schema.ptySessions.id, id));
		},
	};
}

function makeMutations(db: Db): Pick<PtySessionStore, "markEnded" | "rename"> {
	return {
		async markEnded(id, userId) {
			const rows = await db
				.update(schema.ptySessions)
				// Stamp the fine-grained state `ended` in lockstep with the lifecycle
				// so a dashboard never shows a working/idle dot for a dead session.
				.set({
					status: "ended",
					activityState: "ended",
					activityStateAt: new Date(),
				})
				.where(
					and(
						eq(schema.ptySessions.id, id),
						eq(schema.ptySessions.userId, userId)
					)
				)
				.returning();
			const row = rows[0];
			return row ? toRow(row) : null;
		},
		async rename(id, userId, title) {
			const rows = await db
				.update(schema.ptySessions)
				.set({ title })
				.where(
					and(
						eq(schema.ptySessions.id, id),
						eq(schema.ptySessions.userId, userId)
					)
				)
				.returning();
			const row = rows[0];
			return row ? toRow(row) : null;
		},
	};
}

function makeReconcile(
	db: Db
): Pick<PtySessionStore, "touchActivity" | "endStaleExcept"> {
	return {
		async touchActivity(computerId, id) {
			await db
				.update(schema.ptySessions)
				.set({ lastActivityAt: new Date() })
				.where(
					and(
						eq(schema.ptySessions.id, id),
						eq(schema.ptySessions.computerId, computerId)
					)
				);
		},
		async endStaleExcept(computerId, aliveSessionIds, graceMs) {
			const cutoff = new Date(Date.now() - (graceMs ?? DEFAULT_STALE_GRACE_MS));
			// Only reconcile rows old enough to have been opened already; a freshly
			// created (not-yet-opened) session has no pty, so its absence from the
			// CLI's list is expected — sparing it avoids a create↔reconnect race.
			const filters = [
				eq(schema.ptySessions.computerId, computerId),
				eq(schema.ptySessions.status, "active"),
				lt(schema.ptySessions.createdAt, cutoff),
			];
			if (aliveSessionIds.length > 0) {
				filters.push(notInArray(schema.ptySessions.id, aliveSessionIds));
			}
			await db
				.update(schema.ptySessions)
				// Match markEnded: reconciled zombies also get the terminal fine-grained
				// state so the dashboard reflects them as ended, not stuck working.
				.set({
					status: "ended",
					activityState: "ended",
					activityStateAt: new Date(),
				})
				.where(and(...filters));
		},
	};
}

export function createPtySessionStore(db: Db): PtySessionStore {
	return {
		...makeReads(db),
		...makeCreate(db),
		...makeBinding(db),
		...makeMutations(db),
		...makeActivity(db),
		...makeReconcile(db),
	};
}
