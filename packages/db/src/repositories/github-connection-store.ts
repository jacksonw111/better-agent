import type {
	GithubConnectionRow,
	GithubConnectionStore,
	GithubConnectionUpsert,
	GithubCredentialType,
} from "@better-agent/agent/github/github-ports";
import { eq } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
// biome-ignore lint/performance/noNamespaceImport: drizzle 需要整个 schema 命名空间对象
import * as schema from "../schema";

// Driver-agnostic db type: satisfied by node-postgres (production) and PGlite (tests).
type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

function toRow(
	row: typeof schema.githubConnections.$inferSelect
): GithubConnectionRow {
	return {
		id: row.id,
		userId: row.userId,
		credentialType: row.credentialType as GithubCredentialType,
		encryptedToken: row.encryptedToken,
		tokenLast4: row.tokenLast4,
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
	};
}

// Persistence only: callers hand over secret-box ciphertext (the router
// encrypts on connect, decrypts server-side for API calls) — this store
// never sees a plaintext token. One connection per user: upsert replaces.
export function createGithubConnectionStore(db: Db): GithubConnectionStore {
	return {
		async upsert(input: GithubConnectionUpsert) {
			const inserted = await db
				.insert(schema.githubConnections)
				.values(input)
				.onConflictDoUpdate({
					target: schema.githubConnections.userId,
					set: {
						credentialType: input.credentialType,
						encryptedToken: input.encryptedToken,
						tokenLast4: input.tokenLast4,
						updatedAt: new Date(),
					},
				})
				.returning();
			const row = inserted[0];
			if (!row) {
				throw new Error("Failed to upsert github connection");
			}
			return toRow(row);
		},
		async getByUser(userId) {
			const rows = await db
				.select()
				.from(schema.githubConnections)
				.where(eq(schema.githubConnections.userId, userId))
				.limit(1);
			const row = rows[0];
			return row ? toRow(row) : null;
		},
		async deleteByUser(userId) {
			await db
				.delete(schema.githubConnections)
				.where(eq(schema.githubConnections.userId, userId));
		},
	};
}
