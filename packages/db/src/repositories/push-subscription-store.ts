import type {
	PushSubscriptionRow,
	PushSubscriptionStore,
} from "@better-agent/agent/ports";
import { and, eq } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
// biome-ignore lint/performance/noNamespaceImport: drizzle 需要整个 schema 命名空间对象
import * as schema from "../schema";

// Driver-agnostic db type: satisfied by node-postgres (production) and PGlite (tests).
type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

function toRow(
	row: typeof schema.pushSubscriptions.$inferSelect
): PushSubscriptionRow {
	return {
		id: row.id,
		userId: row.userId,
		endpoint: row.endpoint,
		p256dh: row.p256dh,
		auth: row.auth,
		userAgent: row.userAgent,
		createdAt: row.createdAt,
	};
}

/** Web Push subscriptions (P3-T3), one row per browser/device — see
 * schema/push.ts. Upsert is keyed on the globally-unique `endpoint`; delete
 * is owner-guarded for the user route and unguarded (userId null) for the
 * push sender's pruning of provider-reported-dead endpoints. */
export function createPushSubscriptionStore(db: Db): PushSubscriptionStore {
	return {
		async deleteByEndpoint(endpoint, userId) {
			const where =
				userId === null
					? eq(schema.pushSubscriptions.endpoint, endpoint)
					: and(
							eq(schema.pushSubscriptions.endpoint, endpoint),
							eq(schema.pushSubscriptions.userId, userId)
						);
			await db.delete(schema.pushSubscriptions).where(where);
		},
		async listByUser(userId) {
			const rows = await db
				.select()
				.from(schema.pushSubscriptions)
				.where(eq(schema.pushSubscriptions.userId, userId));
			return rows.map(toRow);
		},
		async upsert(input) {
			const [row] = await db
				.insert(schema.pushSubscriptions)
				.values(input)
				.onConflictDoUpdate({
					target: schema.pushSubscriptions.endpoint,
					set: {
						userId: input.userId,
						p256dh: input.p256dh,
						auth: input.auth,
						userAgent: input.userAgent,
					},
				})
				.returning();
			if (!row) {
				throw new Error("push subscription upsert returned no row");
			}
			return toRow(row);
		},
	};
}
