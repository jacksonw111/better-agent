import type { ComputerRegistrationInput } from "@better-agent/agent/computer-ports";
import type { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, expect, it } from "vitest";
import { users } from "../schema/auth";
import { createTestDb, type TestDb } from "../testing/test-db";
import { createComputerStore } from "./computer-store";

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

function registration(userId: string): ComputerRegistrationInput {
	return {
		userId,
		publicKeyPem:
			"-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEA\n-----END PUBLIC KEY-----",
		name: "John's MacBook",
		platform: "darwin",
		arch: "arm64",
		clientVersion: "0.3.0",
		runtimeInventory: [
			{
				agentKind: "claude-code",
				skillCapability: "discoverable",
				skills: [{ name: "research", description: "Deep research" }],
			},
			{ agentKind: "codex", skillCapability: "none", skills: [] },
		],
		toolInventory: [
			{ name: "git", installed: true },
			{ name: "gh", installed: false },
		],
	};
}

it("insert persists a Computer and getById returns it with the public key", async () => {
	const store = createComputerStore(db);
	const userId = await seedUser("alice@x.com");
	const input = registration(userId);

	const created = await store.insert(input);

	expect(created.id).toBeTruthy();
	expect(created.userId).toBe(userId);
	expect(created.publicKeyPem).toBe(input.publicKeyPem);
	expect(created.name).toBe("John's MacBook");
	expect(created.platform).toBe("darwin");
	expect(created.arch).toBe("arm64");
	expect(created.clientVersion).toBe("0.3.0");
	expect(created.runtimeInventory).toEqual(input.runtimeInventory);
	expect(created.toolInventory).toEqual(input.toolInventory);
	expect(created.createdAt).toBeInstanceOf(Date);
	expect(created.updatedAt).toBeInstanceOf(Date);
	expect(created.lastSeenAt).toBeInstanceOf(Date);

	const found = await store.getById(created.id);
	expect(found).toEqual(created);
});

it("getById returns null for an unknown id", async () => {
	const store = createComputerStore(db);
	expect(
		await store.getById("00000000-0000-4000-8000-000000000000")
	).toBeNull();
});

it("listByUser scopes Computers per owner", async () => {
	const store = createComputerStore(db);
	const alice = await seedUser("alice@x.com");
	const bob = await seedUser("bob@x.com");
	const ALICE_COMPUTERS = 2;
	await store.insert(registration(alice));
	await store.insert({ ...registration(alice), name: "Alice's Mini" });
	await store.insert(registration(bob));

	const rows = await store.listByUser(alice);
	expect(rows).toHaveLength(ALICE_COMPUTERS);
	expect(rows.every((row) => row.userId === alice)).toBe(true);
	expect(await store.listByUser(bob)).toHaveLength(1);
});

it("updateInventory replaces inventories + provided attributes; false for unknown id", async () => {
	const store = createComputerStore(db);
	const userId = await seedUser("alice@x.com");
	const created = await store.insert(registration(userId));

	const updated = await store.updateInventory(created.id, {
		clientVersion: "0.3.1",
		runtimeInventory: [
			{ agentKind: "opencode", skillCapability: "none", skills: [] },
		],
		toolInventory: [{ name: "git", installed: true }],
	});
	expect(updated).toBe(true);

	const row = await store.getById(created.id);
	expect(row?.clientVersion).toBe("0.3.1");
	expect(row?.name).toBe("John's MacBook");
	expect(row?.runtimeInventory).toEqual([
		{ agentKind: "opencode", skillCapability: "none", skills: [] },
	]);
	expect(row?.toolInventory).toEqual([{ name: "git", installed: true }]);
	expect(row?.publicKeyPem).toBe(created.publicKeyPem);

	expect(
		await store.updateInventory("00000000-0000-4000-8000-000000000000", {
			runtimeInventory: [],
			toolInventory: [],
		})
	).toBe(false);
});

it("touch records the heartbeat time; false for an unknown id", async () => {
	const store = createComputerStore(db);
	const userId = await seedUser("alice@x.com");
	const created = await store.insert(registration(userId));
	const heartbeatAt = new Date("2026-07-15T12:00:00.000Z");

	expect(await store.touch(created.id, heartbeatAt)).toBe(true);
	expect(
		await store.touch("00000000-0000-4000-8000-000000000000", heartbeatAt)
	).toBe(false);
	expect((await store.getById(created.id))?.lastSeenAt).toEqual(heartbeatAt);
});

it("deleteById only removes the caller's own Computer", async () => {
	const store = createComputerStore(db);
	const alice = await seedUser("alice@x.com");
	const bob = await seedUser("bob@x.com");
	const created = await store.insert(registration(alice));

	expect(await store.deleteById(created.id, bob)).toBe(false);
	expect(await store.getById(created.id)).not.toBeNull();

	expect(await store.deleteById(created.id, alice)).toBe(true);
	expect(await store.getById(created.id)).toBeNull();
});

it("consumePairingCode consumes a live code exactly once", async () => {
	const store = createComputerStore(db);
	const userId = await seedUser("alice@x.com");
	const now = new Date("2026-07-15T12:00:00.000Z");
	const expiresAt = new Date("2026-07-15T12:10:00.000Z");
	await store.createPairingCode({ userId, codeHash: "hash-1", expiresAt });

	expect(await store.consumePairingCode("hash-1", now)).toEqual({ userId });
	// Single use: a second consume of the same code is rejected.
	expect(await store.consumePairingCode("hash-1", now)).toBeNull();
});

it("consumePairingCode rejects expired and unknown codes", async () => {
	const store = createComputerStore(db);
	const userId = await seedUser("alice@x.com");
	const expiresAt = new Date("2026-07-15T12:10:00.000Z");
	await store.createPairingCode({ userId, codeHash: "hash-1", expiresAt });

	const afterExpiry = new Date("2026-07-15T12:10:00.001Z");
	expect(await store.consumePairingCode("hash-1", afterExpiry)).toBeNull();
	// An expired attempt must not burn the code's unused state... it stays
	// expired anyway, and unknown hashes are rejected outright.
	expect(await store.consumePairingCode("nope", new Date())).toBeNull();
});

it("createPairingCode rejects a duplicate code hash", async () => {
	const store = createComputerStore(db);
	const userId = await seedUser("alice@x.com");
	const expiresAt = new Date("2026-07-15T12:10:00.000Z");
	await store.createPairingCode({ userId, codeHash: "hash-1", expiresAt });

	await expect(
		store.createPairingCode({ userId, codeHash: "hash-1", expiresAt })
	).rejects.toThrow();
});
