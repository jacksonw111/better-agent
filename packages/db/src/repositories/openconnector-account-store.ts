import type { SecretBox } from "@better-agent/agent/crypto/secret-box";
import type {
	OpenConnectorAccountRow,
	OpenConnectorAccountStore,
} from "@better-agent/agent/ports";
import { desc, eq } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
// biome-ignore lint/performance/noNamespaceImport: drizzle 需要整个 schema 命名空间对象
import * as schema from "../schema";

// Driver-agnostic db type: satisfied by node-postgres (production) and PGlite (tests).
type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

const LAST4 = 4;

function toRow(
	row: typeof schema.openConnectorAccounts.$inferSelect
): OpenConnectorAccountRow {
	return {
		id: row.id,
		name: row.name,
		baseUrl: row.baseUrl,
		adminTokenLast4: row.adminTokenLast4,
		runtimeTokenLast4: row.runtimeTokenLast4,
		userId: row.userId ?? null,
		createdAt: row.createdAt,
	};
}

function makeAccountReads(
	db: Db,
	box: SecretBox
): Pick<
	OpenConnectorAccountStore,
	"list" | "listByUser" | "getById" | "getSecrets"
> {
	const findRow = async (id: string) => {
		const rows = await db
			.select()
			.from(schema.openConnectorAccounts)
			.where(eq(schema.openConnectorAccounts.id, id))
			.limit(1);
		return rows[0] ?? null;
	};
	return {
		async list() {
			const rows = await db
				.select()
				.from(schema.openConnectorAccounts)
				.orderBy(desc(schema.openConnectorAccounts.createdAt));
			return rows.map(toRow);
		},
		async listByUser(userId) {
			const rows = await db
				.select()
				.from(schema.openConnectorAccounts)
				.where(eq(schema.openConnectorAccounts.userId, userId))
				.orderBy(desc(schema.openConnectorAccounts.createdAt));
			return rows.map(toRow);
		},
		async getById(id) {
			const row = await findRow(id);
			return row ? toRow(row) : null;
		},
		async getSecrets(id) {
			const row = await findRow(id);
			if (!row) {
				return null;
			}
			return {
				baseUrl: row.baseUrl,
				adminToken: box.decrypt(row.adminTokenCipher),
				runtimeToken: box.decrypt(row.runtimeTokenCipher),
			};
		},
	};
}

export function createOpenConnectorAccountStore(
	db: Db,
	box: SecretBox
): OpenConnectorAccountStore {
	return {
		...makeAccountReads(db, box),
		async create({ name, baseUrl, adminToken, runtimeToken, userId }) {
			const inserted = await db
				.insert(schema.openConnectorAccounts)
				.values({
					name,
					userId,
					baseUrl,
					adminTokenCipher: box.encrypt(adminToken),
					adminTokenLast4: adminToken.slice(-LAST4),
					runtimeTokenCipher: box.encrypt(runtimeToken),
					runtimeTokenLast4: runtimeToken.slice(-LAST4),
				})
				.returning();
			const row = inserted[0];
			if (!row) {
				throw new Error("Failed to create open connector account");
			}
			return toRow(row);
		},
		async delete(id) {
			await db
				.delete(schema.openConnectorAccounts)
				.where(eq(schema.openConnectorAccounts.id, id));
		},
	};
}
