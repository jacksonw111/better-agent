import type { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, expect, it } from "vitest";
import { users } from "../schema/auth";
import { createTestDb, type TestDb } from "../testing/test-db";
import { createPushSubscriptionStore } from "./push-subscription-store";

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

function subInput(userId: string, endpoint: string) {
	return {
		userId,
		endpoint,
		p256dh: "p256dh-key",
		auth: "auth-secret",
		userAgent: "test-browser/1.0",
	};
}

it("upserts a subscription and lists it by user", async () => {
	const store = createPushSubscriptionStore(db);
	const userId = await seedUser("a@x.com");
	const row = await store.upsert(subInput(userId, "https://push.example/1"));
	expect(row.endpoint).toBe("https://push.example/1");
	expect(row.userAgent).toBe("test-browser/1.0");
	const listed = await store.listByUser(userId);
	expect(listed).toHaveLength(1);
	expect(listed[0]?.id).toBe(row.id);
});

it("upsert on the same endpoint replaces instead of duplicating", async () => {
	const store = createPushSubscriptionStore(db);
	const alice = await seedUser("a@x.com");
	const bob = await seedUser("b@x.com");
	await store.upsert(subInput(alice, "https://push.example/shared"));
	// A different user signing in on the same browser re-subscribes the same
	// endpoint — the row must move to them, not duplicate.
	await store.upsert({
		...subInput(bob, "https://push.example/shared"),
		p256dh: "new-key",
	});
	expect(await store.listByUser(alice)).toHaveLength(0);
	const bobRows = await store.listByUser(bob);
	expect(bobRows).toHaveLength(1);
	expect(bobRows[0]?.p256dh).toBe("new-key");
});

it("deleteByEndpoint is owner-guarded with a userId", async () => {
	const store = createPushSubscriptionStore(db);
	const alice = await seedUser("a@x.com");
	const bob = await seedUser("b@x.com");
	await store.upsert(subInput(alice, "https://push.example/a"));
	await store.deleteByEndpoint("https://push.example/a", bob);
	expect(await store.listByUser(alice)).toHaveLength(1);
	await store.deleteByEndpoint("https://push.example/a", alice);
	expect(await store.listByUser(alice)).toHaveLength(0);
});

it("deleteByEndpoint with null userId prunes regardless of owner", async () => {
	const store = createPushSubscriptionStore(db);
	const alice = await seedUser("a@x.com");
	await store.upsert(subInput(alice, "https://push.example/expired"));
	await store.deleteByEndpoint("https://push.example/expired", null);
	expect(await store.listByUser(alice)).toHaveLength(0);
});
