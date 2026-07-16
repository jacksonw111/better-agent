import type { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, expect, it } from "vitest";
import { users } from "../schema/auth";
import { createTestDb, type TestDb } from "../testing/test-db";
import { createKnowledgeDocumentStore } from "./knowledge-document-store";

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

function docInput(ownerId: string, name: string, size = 10) {
	return {
		ownerId,
		name,
		mime: "application/pdf",
		size,
		r2Key: `knowledge/${ownerId}/${name}`,
		uploadId: "upload-1",
		partSize: 8,
	};
}

it("insert starts a document in uploading and markReady flips it", async () => {
	const store = createKnowledgeDocumentStore(db);
	const ownerId = await seedUser("alice@x.com");

	const row = await store.insert(docInput(ownerId, "report.pdf"));
	expect(row.status).toBe("uploading");
	expect(row.uploadId).toBe("upload-1");

	const ready = await store.markReady(row.id);
	expect(ready?.status).toBe("ready");
	expect(ready?.uploadId).toBeNull();
});

it("getByIdForOwner scopes reads to the owner", async () => {
	const store = createKnowledgeDocumentStore(db);
	const alice = await seedUser("alice@x.com");
	const bob = await seedUser("bob@x.com");
	const row = await store.insert(docInput(alice, "report.pdf"));

	await expect(store.getByIdForOwner(alice, row.id)).resolves.toMatchObject({
		id: row.id,
	});
	await expect(store.getByIdForOwner(bob, row.id)).resolves.toBeNull();
});

it("findPendingUpload matches owner+name+size while uploading only", async () => {
	const store = createKnowledgeDocumentStore(db);
	const ownerId = await seedUser("alice@x.com");
	const row = await store.insert(docInput(ownerId, "report.pdf", 42));

	const query = { ownerId, name: "report.pdf", size: 42 };
	await expect(store.findPendingUpload(query)).resolves.toMatchObject({
		id: row.id,
	});
	await expect(
		store.findPendingUpload({ ...query, size: 41 })
	).resolves.toBeNull();

	await store.markReady(row.id);
	await expect(store.findPendingUpload(query)).resolves.toBeNull();
});

it("listByOwner returns ready rows only, searched and paginated", async () => {
	const store = createKnowledgeDocumentStore(db);
	const ownerId = await seedUser("alice@x.com");
	const names = ["alpha.pdf", "beta.pdf", "gamma.txt"];
	for (const name of names) {
		const row = await store.insert(docInput(ownerId, name));
		await store.markReady(row.id);
	}
	await store.insert(docInput(ownerId, "pending.pdf"));

	const all = await store.listByOwner({ ownerId, limit: 10, offset: 0 });
	expect(all.total).toBe(3);
	expect(all.items.map((item) => item.name)).not.toContain("pending.pdf");

	const searched = await store.listByOwner({
		ownerId,
		limit: 10,
		offset: 0,
		search: "PDF",
	});
	expect(searched.total).toBe(2);

	const page = await store.listByOwner({ ownerId, limit: 2, offset: 2 });
	expect(page.items).toHaveLength(1);
	expect(page.total).toBe(3);
});

it("delete removes the row", async () => {
	const store = createKnowledgeDocumentStore(db);
	const ownerId = await seedUser("alice@x.com");
	const row = await store.insert(docInput(ownerId, "report.pdf"));

	await store.delete(row.id);
	await expect(store.getByIdForOwner(ownerId, row.id)).resolves.toBeNull();
});
