import { createSecretBox } from "@better-agent/agent/crypto/secret-box";
import type { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, expect, it } from "vitest";
import { users } from "../schema/auth";
import { createTestDb, type TestDb } from "../testing/test-db";
import { createOpenConnectorAccountStore } from "./openconnector-account-store";

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

it("listByUser returns only the owner's accounts and excludes others", async () => {
	const store = createOpenConnectorAccountStore(db, box);
	const alice = await seedUser("alice@x.com");
	const bob = await seedUser("bob@x.com");

	const mine = await store.create({
		name: "Mine",
		baseUrl: "https://alice.oc.example",
		adminToken: "oc_admin_1234",
		runtimeToken: "oc_runtime_abcd",
		userId: alice,
	});
	await store.create({
		name: "Bobs",
		baseUrl: "https://bob.oc.example",
		adminToken: "oc_admin_5678",
		runtimeToken: "oc_runtime_efgh",
		userId: bob,
	});
	await store.create({
		name: "Legacy",
		baseUrl: "https://legacy.oc.example",
		adminToken: "oc_admin_0000",
		runtimeToken: "oc_runtime_0000",
	});

	const aliceAccounts = await store.listByUser(alice);
	expect(aliceAccounts).toHaveLength(1);
	expect(aliceAccounts[0]?.id).toBe(mine.id);
	expect(aliceAccounts[0]?.userId).toBe(alice);
	expect(aliceAccounts[0]?.adminTokenLast4).toBe("1234");
	expect(aliceAccounts[0]?.runtimeTokenLast4).toBe("abcd");
	expect((await store.list()).length).toBe(3);
});

it("getSecrets round-trips the encrypted tokens", async () => {
	const store = createOpenConnectorAccountStore(db, box);
	const owner = await seedUser("k@x.com");
	const account = await store.create({
		name: "K",
		baseUrl: "https://k.oc.example",
		adminToken: "oc_admin_secret_9999",
		runtimeToken: "oc_runtime_secret_7777",
		userId: owner,
	});

	const secrets = await store.getSecrets(account.id);
	expect(secrets).toEqual({
		baseUrl: "https://k.oc.example",
		adminToken: "oc_admin_secret_9999",
		runtimeToken: "oc_runtime_secret_7777",
	});

	expect(
		await store.getSecrets("00000000-0000-0000-0000-000000000000")
	).toBeNull();
});
