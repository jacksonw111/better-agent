import type {
	BridgeMessageRow,
	BridgeMessageStore,
} from "@better-agent/agent/ports";
import { and, asc, eq, gt } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
// biome-ignore lint/performance/noNamespaceImport: drizzle 需要整个 schema 命名空间对象
import * as schema from "../schema";

// Driver-agnostic db type: satisfied by node-postgres (production) and PGlite (tests).
type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

function toRow(
	row: typeof schema.bridgeMessages.$inferSelect
): BridgeMessageRow {
	return { seq: row.seq, event: row.event };
}

// Persists relayed bridge events (session-scoped) so a Local Agent
// conversation survives a page reload — the relay store itself is a
// Redis-backed rolling window that TTLs out. Owner isolation is enforced by
// the API layer (requireOwnedBridgeSession) before this store is ever
// touched, so append/list only need to be session-scoped.
export function createBridgeMessageStore(db: Db): BridgeMessageStore {
	return {
		async append(sessionId, seq, event) {
			await db.insert(schema.bridgeMessages).values({ sessionId, seq, event });
		},
		async appendMany(sessionId, rows) {
			if (rows.length === 0) {
				return;
			}
			await db
				.insert(schema.bridgeMessages)
				.values(rows.map(({ seq, event }) => ({ sessionId, seq, event })));
		},
		async list(sessionId, afterSeq, limit) {
			const rows = await db
				.select()
				.from(schema.bridgeMessages)
				.where(
					and(
						eq(schema.bridgeMessages.sessionId, sessionId),
						gt(schema.bridgeMessages.seq, afterSeq)
					)
				)
				.orderBy(asc(schema.bridgeMessages.seq))
				.limit(limit);
			return rows.map(toRow);
		},
	};
}
