import type {
	ComputerRow,
	ComputerStore,
} from "@better-agent/agent/computer-ports";
import { and, desc, eq, gt, isNull } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
// biome-ignore lint/performance/noNamespaceImport: drizzle 需要整个 schema 命名空间对象
import * as schema from "../schema";

// Driver-agnostic db type: satisfied by node-postgres (production) and PGlite (tests).
type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

function toRow(row: typeof schema.computers.$inferSelect): ComputerRow {
	return {
		id: row.id,
		userId: row.userId,
		publicKeyPem: row.publicKeyPem,
		name: row.name,
		platform: row.platform ?? null,
		arch: row.arch ?? null,
		clientVersion: row.clientVersion ?? null,
		runtimeInventory: row.runtimeInventory ?? [],
		toolInventory: row.toolInventory ?? [],
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
		lastSeenAt: row.lastSeenAt,
	};
}

function makeComputerReads(
	db: Db
): Pick<ComputerStore, "getById" | "listByUser"> {
	return {
		// Returns publicKeyPem too — callers verify request signatures with it.
		async getById(id) {
			const rows = await db
				.select()
				.from(schema.computers)
				.where(eq(schema.computers.id, id))
				.limit(1);
			const row = rows[0];
			return row ? toRow(row) : null;
		},
		async listByUser(userId) {
			const rows = await db
				.select()
				.from(schema.computers)
				.where(eq(schema.computers.userId, userId))
				.orderBy(desc(schema.computers.createdAt));
			return rows.map(toRow);
		},
	};
}

function makeComputerWrites(
	db: Db
): Pick<ComputerStore, "insert" | "updateInventory" | "touch" | "deleteById"> {
	return {
		async insert(input) {
			const rows = await db.insert(schema.computers).values(input).returning();
			const row = rows[0];
			if (!row) {
				throw new Error("Failed to insert computer");
			}
			return toRow(row);
		},
		// Inventories are replaced whole; plain attributes only when provided
		// (drizzle skips undefined values in `set`).
		async updateInventory(id, update) {
			const rows = await db
				.update(schema.computers)
				.set({ ...update, updatedAt: new Date() })
				.where(eq(schema.computers.id, id))
				.returning({ id: schema.computers.id });
			return rows.length > 0;
		},
		async touch(id, lastSeenAt) {
			const rows = await db
				.update(schema.computers)
				.set({ lastSeenAt })
				.where(eq(schema.computers.id, id))
				.returning({ id: schema.computers.id });
			return rows.length > 0;
		},
		async deleteById(id, userId) {
			const rows = await db
				.delete(schema.computers)
				.where(
					and(eq(schema.computers.id, id), eq(schema.computers.userId, userId))
				)
				.returning({ id: schema.computers.id });
			return rows.length > 0;
		},
	};
}

function makePairingCodes(
	db: Db
): Pick<ComputerStore, "createPairingCode" | "consumePairingCode"> {
	return {
		async createPairingCode({ userId, codeHash, expiresAt }) {
			await db
				.insert(schema.computerPairingCodes)
				.values({ userId, codeHash, expiresAt });
		},
		// Atomic single-use consume: the UPDATE only matches an unused (used_at
		// IS NULL), unexpired row, so two concurrent attempts can never both win.
		async consumePairingCode(codeHash, now) {
			const rows = await db
				.update(schema.computerPairingCodes)
				.set({ usedAt: now })
				.where(
					and(
						eq(schema.computerPairingCodes.codeHash, codeHash),
						isNull(schema.computerPairingCodes.usedAt),
						gt(schema.computerPairingCodes.expiresAt, now)
					)
				)
				.returning({ userId: schema.computerPairingCodes.userId });
			const row = rows[0];
			return row ? { userId: row.userId } : null;
		},
	};
}

export function createComputerStore(db: Db): ComputerStore {
	return {
		...makeComputerReads(db),
		...makeComputerWrites(db),
		...makePairingCodes(db),
	};
}
