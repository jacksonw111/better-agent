import type {
	BridgeTokenRow,
	BridgeTokenStore,
} from "@better-agent/agent/ports";
import { and, eq } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
// biome-ignore lint/performance/noNamespaceImport: drizzle 需要整个 schema 命名空间对象
import * as schema from "../schema";

// Driver-agnostic db type: satisfied by node-postgres (production) and PGlite (tests).
type Db = PgDatabase<PgQueryResultHKT, typeof schema>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

function toRow(row: typeof schema.bridgeTokens.$inferSelect): BridgeTokenRow {
	return {
		id: row.id,
		userId: row.userId,
		name: row.name ?? null,
		agentKind: row.agentKind,
		token: row.token ?? null,
		last4: row.last4 ?? null,
		config: (row.config ?? null) as BridgeTokenRow["config"],
		createdAt: row.createdAt,
		revokedAt: row.revokedAt ?? null,
	};
}

/** Deletes every session belonging to `tokenId`, within the caller's
 * transaction, so the token can then be removed without violating the
 * bridge_sessions → bridge_tokens FK. */
async function deleteSessionsForToken(tx: Tx, tokenId: string): Promise<void> {
	await tx
		.delete(schema.bridgeSessions)
		.where(eq(schema.bridgeSessions.tokenId, tokenId));
}

/** Hard-deletes `id` (and all of its sessions) if it belongs to `userId`, in
 * one transaction. A no-op when the token isn't the caller's. */
async function deleteAgentAndSessions(
	db: Db,
	id: string,
	userId: string
): Promise<void> {
	await db.transaction(async (tx) => {
		const owned = await tx
			.select({ id: schema.bridgeTokens.id })
			.from(schema.bridgeTokens)
			.where(
				and(
					eq(schema.bridgeTokens.id, id),
					eq(schema.bridgeTokens.userId, userId)
				)
			)
			.limit(1);
		if (owned.length === 0) {
			return;
		}
		await deleteSessionsForToken(tx, id);
		await tx.delete(schema.bridgeTokens).where(eq(schema.bridgeTokens.id, id));
	});
}

async function getTokenById(
	db: Db,
	id: string,
	userId: string
): Promise<BridgeTokenRow | null> {
	const rows = await db
		.select()
		.from(schema.bridgeTokens)
		.where(
			and(
				eq(schema.bridgeTokens.id, id),
				eq(schema.bridgeTokens.userId, userId)
			)
		)
		.limit(1);
	const row = rows[0];
	return row ? toRow(row) : null;
}

/** Replaces the token's persisted startup config (Phase 4), owner-scoped —
 * returns null (no row touched) for a non-owner. Extracted to a module-level
 * helper so `createBridgeTokenStore` stays under the max-lines-per-function
 * gate, mirroring `getTokenById`. */
async function updateTokenConfig(
	db: Db,
	id: string,
	userId: string,
	config: BridgeTokenRow["config"]
): Promise<BridgeTokenRow | null> {
	const rows = await db
		.update(schema.bridgeTokens)
		.set({ config })
		.where(
			and(
				eq(schema.bridgeTokens.id, id),
				eq(schema.bridgeTokens.userId, userId)
			)
		)
		.returning();
	const updated = rows[0];
	return updated ? toRow(updated) : null;
}

export function createBridgeTokenStore(db: Db): BridgeTokenStore {
	return {
		async create({ userId, name, agentKind, token, tokenHash, last4, config }) {
			const rows = await db
				.insert(schema.bridgeTokens)
				.values({ userId, name, agentKind, token, tokenHash, last4, config })
				.returning();
			const row = rows[0];
			if (!row) {
				throw new Error("Failed to create bridge token");
			}
			return toRow(row);
		},
		async listByUser(userId) {
			const rows = await db
				.select()
				.from(schema.bridgeTokens)
				.where(eq(schema.bridgeTokens.userId, userId));
			return rows.map(toRow);
		},
		getById(id, userId) {
			return getTokenById(db, id, userId);
		},
		async findByHash(tokenHash) {
			const rows = await db
				.select({
					id: schema.bridgeTokens.id,
					userId: schema.bridgeTokens.userId,
					revokedAt: schema.bridgeTokens.revokedAt,
				})
				.from(schema.bridgeTokens)
				.where(eq(schema.bridgeTokens.tokenHash, tokenHash))
				.limit(1);
			const row = rows[0];
			return row ? { ...row, revokedAt: row.revokedAt ?? null } : null;
		},
		deleteAgent(id, userId) {
			return deleteAgentAndSessions(db, id, userId);
		},
		updateConfig(id, userId, config) {
			return updateTokenConfig(db, id, userId, config);
		},
	};
}
