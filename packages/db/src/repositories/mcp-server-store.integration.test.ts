import { createSecretBox } from "@better-agent/agent/crypto/secret-box";
import type { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, expect, it } from "vitest";
import { users } from "../schema/auth";
import { createTestDb, type TestDb } from "../testing/test-db";
import { createMcpServerStore } from "./mcp-server-store";

const box = createSecretBox("integration-test-secret-key-please-32+");

let db: TestDb;
let client: PGlite;

beforeEach(async () => {
	({ db, client } = await createTestDb());
});

afterEach(async () => {
	await client.close();
});

async function seedUser(email: string): Promise<string> {
	const [row] = await db.insert(users).values({ email }).returning();
	return row?.id ?? "";
}

it("scopes servers per owner and round-trips the encrypted auth header", async () => {
	const store = createMcpServerStore(db, box);
	const alice = await seedUser("alice@x.com");
	const bob = await seedUser("bob@x.com");

	const mine = await store.create({
		name: "X API",
		url: "https://api.x.com/mcp",
		authHeader: "Bearer tok_secret_9999",
		userId: alice,
	});
	await store.create({
		name: "Docs",
		url: "https://docs.x.com/mcp",
		userId: bob,
	});

	const aliceServers = await store.listByUser(alice);
	expect(aliceServers).toHaveLength(1);
	expect(aliceServers[0]?.id).toBe(mine.id);
	expect(aliceServers[0]?.authLast4).toBe("9999");
	expect(await store.getAuthHeader(mine.id)).toBe("Bearer tok_secret_9999");

	const bobServers = await store.listByUser(bob);
	expect(bobServers[0]?.authLast4).toBeNull();
	expect(await store.getAuthHeader(bobServers[0]?.id ?? "")).toBeNull();
});

it("update() patches only the given fields, and null clears the auth header", async () => {
	const store = createMcpServerStore(db, box);
	const alice = await seedUser("alice2@x.com");
	const server = await store.create({
		name: "X API",
		url: "https://api.x.com/mcp",
		authHeader: "Bearer tok_secret_9999",
		userId: alice,
	});

	const renamed = await store.update(server.id, { name: "X API v2" });
	expect(renamed).toMatchObject({
		name: "X API v2",
		url: "https://api.x.com/mcp",
		authLast4: "9999",
	});

	const cleared = await store.update(server.id, { authHeader: null });
	expect(cleared?.authLast4).toBeNull();
	expect(await store.getAuthHeader(server.id)).toBeNull();
	// Name from the earlier patch survives an unrelated later patch.
	expect(cleared?.name).toBe("X API v2");

	expect(
		await store.update("00000000-0000-0000-0000-000000000000", {
			name: "nope",
		})
	).toBeNull();
});
