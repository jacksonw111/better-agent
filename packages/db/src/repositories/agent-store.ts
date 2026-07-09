import type { SecretBox } from "@better-agent/agent/crypto/secret-box";
import type { AgentStore } from "@better-agent/agent/ports";
import { eq } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
// biome-ignore lint/performance/noNamespaceImport: drizzle 需要整个 schema 命名空间对象
import * as schema from "../schema";

// Driver-agnostic db type: satisfied by node-postgres (production) and PGlite (tests).
type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

type AgentRow = typeof schema.agents.$inferSelect;

function toAgentConfig(row: AgentRow) {
	return {
		id: row.id,
		name: row.name,
		description: row.description,
		systemPrompt: row.systemPrompt,
		providerId: row.providerId,
		modelId: row.modelId,
		params: row.params ?? null,
		composioAccountIds: row.composioAccountIds ?? [],
		openConnectorAccountIds: row.openConnectorAccountIds ?? [],
		mcpServerIds: row.mcpServerIds ?? [],
		toolAllowlist: row.toolAllowlist ?? null,
		builtinTools: row.builtinTools ?? [],
		userId: row.userId ?? null,
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
	};
}

const sealToken = (box: SecretBox, token: string | undefined): string | null =>
	token === undefined ? null : box.encrypt(token);

function makeAgentReadOps(
	db: Db,
	box: SecretBox
): Pick<AgentStore, "findByTokenHash" | "getToken"> {
	return {
		async findByTokenHash(tokenHash) {
			const rows = await db
				.select()
				.from(schema.agents)
				.where(eq(schema.agents.tokenHash, tokenHash))
				.limit(1);
			const row = rows[0];
			return row ? toAgentConfig(row) : null;
		},
		async getToken(id) {
			const rows = await db
				.select({ tokenCipher: schema.agents.tokenCipher })
				.from(schema.agents)
				.where(eq(schema.agents.id, id))
				.limit(1);
			const cipher = rows[0]?.tokenCipher;
			return cipher ? box.decrypt(cipher) : null;
		},
	};
}

function makeAgentWriteOps(
	db: Db,
	box: SecretBox
): Pick<AgentStore, "create" | "rotateToken"> {
	return {
		async create({ token, ...rest }) {
			const rows = await db
				.insert(schema.agents)
				.values({ ...rest, tokenCipher: sealToken(box, token) })
				.returning();
			const row = rows[0];
			if (!row) {
				throw new Error("Failed to create agent");
			}
			return toAgentConfig(row);
		},
		async rotateToken(id, tokenHash, token) {
			const rows = await db
				.update(schema.agents)
				.set({
					tokenHash,
					tokenCipher: sealToken(box, token),
					updatedAt: new Date(),
				})
				.where(eq(schema.agents.id, id))
				.returning();
			const row = rows[0];
			return row ? toAgentConfig(row) : null;
		},
	};
}

// Removes a value from a jsonb id-array column across all of a user's agents.
async function unlinkFromColumn(
	db: Db,
	userId: string,
	column: "mcpServerIds" | "composioAccountIds" | "openConnectorAccountIds",
	id: string
): Promise<void> {
	const rows = await db
		.select()
		.from(schema.agents)
		.where(eq(schema.agents.userId, userId));
	for (const row of rows) {
		const ids = row[column] ?? [];
		if (ids.includes(id)) {
			await db
				.update(schema.agents)
				.set({
					[column]: ids.filter((value) => value !== id),
					updatedAt: new Date(),
				})
				.where(eq(schema.agents.id, row.id));
		}
	}
}

export function createAgentStore(db: Db, box: SecretBox): AgentStore {
	return {
		...makeAgentReadOps(db, box),
		...makeAgentWriteOps(db, box),
		async get(id) {
			const rows = await db
				.select()
				.from(schema.agents)
				.where(eq(schema.agents.id, id))
				.limit(1);
			const row = rows[0];
			return row ? toAgentConfig(row) : null;
		},
		async list() {
			const rows = await db.select().from(schema.agents);
			return rows.map(toAgentConfig);
		},
		async listByUser(userId) {
			const rows = await db
				.select()
				.from(schema.agents)
				.where(eq(schema.agents.userId, userId));
			return rows.map(toAgentConfig);
		},
		async update(id, input) {
			const rows = await db
				.update(schema.agents)
				.set({ ...input, updatedAt: new Date() })
				.where(eq(schema.agents.id, id))
				.returning();
			const row = rows[0];
			return row ? toAgentConfig(row) : null;
		},
		async delete(id) {
			await db.delete(schema.agents).where(eq(schema.agents.id, id));
		},
		unlinkMcpServer(userId, serverId) {
			return unlinkFromColumn(db, userId, "mcpServerIds", serverId);
		},
		unlinkComposioAccount(userId, accountId) {
			return unlinkFromColumn(db, userId, "composioAccountIds", accountId);
		},
		unlinkOpenConnectorAccount(userId, accountId) {
			return unlinkFromColumn(db, userId, "openConnectorAccountIds", accountId);
		},
	};
}
