import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
// pgvector is not bundled in PGlite's core WASM; this loadable extension adds
// it so the memory migration's `CREATE EXTENSION vector` (+ vector columns and
// the HNSW index) applies on PGlite exactly as it does on production Postgres.
import { vector } from "@electric-sql/pglite-pgvector";
import { drizzle, type PgliteDatabase } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
// biome-ignore lint/performance/noNamespaceImport: drizzle 需要整个 schema 命名空间对象
import * as schema from "../schema";

const MIGRATIONS_DIR = join(
	dirname(fileURLToPath(import.meta.url)),
	"..",
	"migrations"
);

export type TestDb = PgliteDatabase<typeof schema>;

/**
 * Creates a fresh, in-memory PGlite (real Postgres compiled to WASM) database
 * with the full schema applied via migrations. Each call returns an isolated,
 * ephemeral database — nothing persists across calls, so tests never touch real
 * data. Call `client.close()` when done.
 */
export async function createTestDb(): Promise<{
	db: TestDb;
	client: PGlite;
}> {
	const client = new PGlite({ extensions: { vector } });
	const db = drizzle(client, { schema });
	await migrate(db, { migrationsFolder: MIGRATIONS_DIR });
	return { db, client };
}
