import type {
	BridgeSessionCursor,
	BridgeSessionRow,
	BridgeSessionStore,
} from "@better-agent/agent/ports";
import { and, desc, eq, lt, or } from "drizzle-orm";
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
const MS_PER_SECOND = 1000;

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
		vncEndpoint: row.vncEndpoint ?? null,
	};
}

// A single guarded UPDATE (not a read-then-write) so the throttle check and
// the write stay atomic under concurrent pollers. App-side timestamps (the db
// layer forbids raw `sql`); the throttle window (15s) and the web's ~30s
// live/idle threshold are coarse enough that app/server clock skew is
// immaterial.
async function touchSession(db: Db, id: string): Promise<void> {
	const now = new Date();
	const staleBefore = new Date(
		now.getTime() - TOUCH_THROTTLE_SECONDS * MS_PER_SECOND
	);
	await db
		.update(schema.bridgeSessions)
		.set({ lastSeenAt: now })
		.where(
			and(
				eq(schema.bridgeSessions.id, id),
				lt(schema.bridgeSessions.lastSeenAt, staleBefore)
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

async function setSessionVncEndpoint(
	db: Db,
	id: string,
	vncEndpoint: string | null
): Promise<void> {
	await db
		.update(schema.bridgeSessions)
		.set({ vncEndpoint })
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

/** One newest-first page (createdAt DESC, id DESC) of `userId`'s sessions.
 * `before` is a keyset cursor: rows strictly after that (createdAt, id)
 * position in the sort order — `createdAt < c` OR (`createdAt = c` AND
 * `id < c.id`) — so paging stays stable while new sessions are created. */
async function listSessionPage(
	db: Db,
	userId: string,
	opts: { limit: number; before?: BridgeSessionCursor }
): Promise<BridgeSessionRow[]> {
	const { createdAt, id } = schema.bridgeSessions;
	const cursorFilter = opts.before
		? or(
				lt(createdAt, opts.before.createdAt),
				and(eq(createdAt, opts.before.createdAt), lt(id, opts.before.id))
			)
		: undefined;
	const rows = await db
		.select()
		.from(schema.bridgeSessions)
		.where(and(eq(schema.bridgeSessions.userId, userId), cursorFilter))
		.orderBy(desc(createdAt), desc(id))
		.limit(opts.limit);
	return rows.map(toRow);
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
		listPageByUser: (userId, opts) => listSessionPage(db, userId, opts),
		touch: (id) => touchSession(db, id),
		setAgentSessionId: (id, agentSessionId) =>
			setSessionAgentSessionId(db, id, agentSessionId),
		setVncEndpoint: (id, vncEndpoint) =>
			setSessionVncEndpoint(db, id, vncEndpoint),
		end: (id, userId) => endSession(db, id, userId),
	};
}
