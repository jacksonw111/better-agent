import type {
	BridgeSessionRow,
	BridgeSessionStore,
} from "@better-agent/agent/ports";
import { and, eq, sql } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
// biome-ignore lint/performance/noNamespaceImport: drizzle 需要整个 schema 命名空间对象
import * as schema from "../schema";

// Driver-agnostic db type: satisfied by node-postgres (production) and PGlite (tests).
type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

// touch() is called on every bridge poll (pollCommands runs every 0.5-2s per
// connected agent, pushEvents on every relayed batch), so an unconditional
// UPDATE on every call is 10-30x more writes than needed. Throttling to once
// per this window still keeps liveness correct: the web's "live vs idle"
// threshold is ~30s, so a connected-but-quiet agent's lastSeenAt is never
// more than TOUCH_THROTTLE_SECONDS stale.
const TOUCH_THROTTLE_SECONDS = 15;

function toRow(
	row: typeof schema.bridgeSessions.$inferSelect
): BridgeSessionRow {
	return {
		id: row.id,
		userId: row.userId,
		tokenId: row.tokenId,
		agentKind: row.agentKind,
		label: row.label ?? null,
		agentSessionId: row.agentSessionId ?? null,
		status: row.status,
		createdAt: row.createdAt,
		lastSeenAt: row.lastSeenAt,
	};
}

// A single guarded UPDATE (not a read-then-write) so the throttle check and
// the write stay atomic under concurrent pollers: `now()` is evaluated
// server-side for both the SET and the WHERE guard, avoiding app-clock skew.
async function touchSession(db: Db, id: string): Promise<void> {
	await db
		.update(schema.bridgeSessions)
		.set({ lastSeenAt: sql`now()` })
		.where(
			and(
				eq(schema.bridgeSessions.id, id),
				sql`${schema.bridgeSessions.lastSeenAt} < now() - (${TOUCH_THROTTLE_SECONDS} * interval '1 second')`
			)
		);
}

async function setSessionAgentSessionId(
	db: Db,
	id: string,
	agentSessionId: string
): Promise<void> {
	await db
		.update(schema.bridgeSessions)
		.set({ agentSessionId })
		.where(eq(schema.bridgeSessions.id, id));
}

async function endSession(db: Db, id: string, userId: string): Promise<void> {
	await db
		.update(schema.bridgeSessions)
		.set({ status: "ended" })
		.where(
			and(
				eq(schema.bridgeSessions.id, id),
				eq(schema.bridgeSessions.userId, userId)
			)
		);
}

// Split touch/setAgentSessionId/end out into standalone functions above
// purely to keep this factory under the repo's max-lines-per-function gate.
export function createBridgeSessionStore(db: Db): BridgeSessionStore {
	return {
		async create({ userId, tokenId, agentKind, label }) {
			const rows = await db
				.insert(schema.bridgeSessions)
				.values({ userId, tokenId, agentKind, label })
				.returning();
			const row = rows[0];
			if (!row) {
				throw new Error("Failed to create bridge session");
			}
			return toRow(row);
		},
		async get(id) {
			const rows = await db
				.select()
				.from(schema.bridgeSessions)
				.where(eq(schema.bridgeSessions.id, id))
				.limit(1);
			const row = rows[0];
			return row ? toRow(row) : null;
		},
		async listByUser(userId) {
			const rows = await db
				.select()
				.from(schema.bridgeSessions)
				.where(eq(schema.bridgeSessions.userId, userId));
			return rows.map(toRow);
		},
		touch: (id) => touchSession(db, id),
		setAgentSessionId: (id, agentSessionId) =>
			setSessionAgentSessionId(db, id, agentSessionId),
		end: (id, userId) => endSession(db, id, userId),
	};
}
