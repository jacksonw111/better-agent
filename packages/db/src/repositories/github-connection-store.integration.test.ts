import { createSecretBox } from "@better-agent/agent/crypto/secret-box";
import type { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, expect, it } from "vitest";
import { users } from "../schema/auth";
import { createTestDb, type TestDb } from "../testing/test-db";
import { createGithubConnectionStore } from "./github-connection-store";

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

it("round-trips a secret-box encrypted token through upsert/getByUser", async () => {
	const store = createGithubConnectionStore(db);
	const alice = await seedUser("alice@x.com");

	const saved = await store.upsert({
		userId: alice,
		credentialType: "pat",
		encryptedToken: box.encrypt("github_pat_original_1234"),
		tokenLast4: "1234",
	});
	expect(saved.userId).toBe(alice);
	expect(saved.credentialType).toBe("pat");
	expect(saved.tokenLast4).toBe("1234");
	// Ciphertext at rest — the plaintext never appears in the row.
	expect(saved.encryptedToken).not.toContain("github_pat_original_1234");

	const found = await store.getByUser(alice);
	expect(found?.id).toBe(saved.id);
	expect(box.decrypt(found?.encryptedToken ?? "")).toBe(
		"github_pat_original_1234"
	);
});

it("upsert replaces the existing connection for the same user", async () => {
	const store = createGithubConnectionStore(db);
	const alice = await seedUser("alice@x.com");

	const first = await store.upsert({
		userId: alice,
		credentialType: "pat",
		encryptedToken: box.encrypt("github_pat_old_1111"),
		tokenLast4: "1111",
	});
	const second = await store.upsert({
		userId: alice,
		credentialType: "pat",
		encryptedToken: box.encrypt("github_pat_new_2222"),
		tokenLast4: "2222",
	});

	expect(second.id).toBe(first.id);
	const found = await store.getByUser(alice);
	expect(found?.tokenLast4).toBe("2222");
	expect(box.decrypt(found?.encryptedToken ?? "")).toBe("github_pat_new_2222");
});

it("connections are per-user and deleteByUser removes only the owner's", async () => {
	const store = createGithubConnectionStore(db);
	const alice = await seedUser("alice@x.com");
	const bob = await seedUser("bob@x.com");

	await store.upsert({
		userId: alice,
		credentialType: "pat",
		encryptedToken: box.encrypt("github_pat_alice_aaaa"),
		tokenLast4: "aaaa",
	});
	await store.upsert({
		userId: bob,
		credentialType: "pat",
		encryptedToken: box.encrypt("github_pat_bob_bbbb"),
		tokenLast4: "bbbb",
	});

	await store.deleteByUser(alice);
	expect(await store.getByUser(alice)).toBeNull();
	expect((await store.getByUser(bob))?.tokenLast4).toBe("bbbb");
});
