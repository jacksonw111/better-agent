import type { SecretBox } from "@better-agent/agent/crypto/secret-box";
import type { McpServerRow, McpServerStore } from "@better-agent/agent/ports";
import { desc, eq } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
// biome-ignore lint/performance/noNamespaceImport: drizzle 需要整个 schema 命名空间对象
import * as schema from "../schema";

// Driver-agnostic db type: satisfied by node-postgres (production) and PGlite (tests).
type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

const LAST4 = 4;

function toRow(row: typeof schema.mcpServers.$inferSelect): McpServerRow {
	return {
		id: row.id,
		userId: row.userId,
		name: row.name,
		url: row.url,
		authLast4: row.authLast4 ?? null,
		createdAt: row.createdAt,
	};
}

type UpdateSet = Partial<typeof schema.mcpServers.$inferInsert>;

function buildUpdateSet(
	box: SecretBox,
	patch: { name?: string; url?: string; authHeader?: string | null }
): UpdateSet {
	const set: UpdateSet = {};
	if (patch.name !== undefined) {
		set.name = patch.name;
	}
	if (patch.url !== undefined) {
		set.url = patch.url;
	}
	if (patch.authHeader !== undefined) {
		set.authHeaderCipher = patch.authHeader
			? box.encrypt(patch.authHeader)
			: null;
		set.authLast4 = patch.authHeader ? patch.authHeader.slice(-LAST4) : null;
	}
	return set;
}

function findRow(db: Db, id: string) {
	return db
		.select()
		.from(schema.mcpServers)
		.where(eq(schema.mcpServers.id, id))
		.limit(1)
		.then((rows) => rows[0] ?? null);
}

async function createRow(
	db: Db,
	box: SecretBox,
	input: { name: string; url: string; authHeader?: string; userId: string }
): Promise<McpServerRow> {
	const { name, url, authHeader, userId } = input;
	const inserted = await db
		.insert(schema.mcpServers)
		.values({
			name,
			url,
			userId,
			authHeaderCipher: authHeader ? box.encrypt(authHeader) : null,
			authLast4: authHeader ? authHeader.slice(-LAST4) : null,
		})
		.returning();
	const row = inserted[0];
	if (!row) {
		throw new Error("Failed to create MCP server");
	}
	return toRow(row);
}

async function updateRow(
	db: Db,
	box: SecretBox,
	id: string,
	patch: { name?: string; url?: string; authHeader?: string | null }
): Promise<McpServerRow | null> {
	const set = buildUpdateSet(box, patch);
	if (Object.keys(set).length === 0) {
		const row = await findRow(db, id);
		return row ? toRow(row) : null;
	}
	const rows = await db
		.update(schema.mcpServers)
		.set(set)
		.where(eq(schema.mcpServers.id, id))
		.returning();
	const row = rows[0];
	return row ? toRow(row) : null;
}

export function createMcpServerStore(db: Db, box: SecretBox): McpServerStore {
	return {
		async listByUser(userId) {
			const rows = await db
				.select()
				.from(schema.mcpServers)
				.where(eq(schema.mcpServers.userId, userId))
				.orderBy(desc(schema.mcpServers.createdAt));
			return rows.map(toRow);
		},
		async getById(id) {
			const row = await findRow(db, id);
			return row ? toRow(row) : null;
		},
		async getAuthHeader(id) {
			const row = await findRow(db, id);
			return row?.authHeaderCipher ? box.decrypt(row.authHeaderCipher) : null;
		},
		create: (input) => createRow(db, box, input),
		async delete(id) {
			await db.delete(schema.mcpServers).where(eq(schema.mcpServers.id, id));
		},
		update: (id, patch) => updateRow(db, box, id, patch),
	};
}
