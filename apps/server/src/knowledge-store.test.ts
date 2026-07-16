import type { KnowledgeDocumentMeta } from "@better-agent/db/repositories/knowledge-document-store";
import { expect, it } from "vitest";
import {
	createKnowledgeStore,
	type MultipartBucket,
	type MultipartPart,
} from "./knowledge-store";

// In-memory fakes for the two dependencies. `calls` records the operation
// order so the R2-before-DB delete contract is assertable.

function makeMetaReads(rows: Map<string, KnowledgeDocumentMeta>) {
	return {
		getByIdForOwner: (ownerId: string, id: string) => {
			const row = rows.get(id);
			return Promise.resolve(row && row.ownerId === ownerId ? row : null);
		},
		findPendingUpload: (input: {
			name: string;
			ownerId: string;
			size: number;
		}) =>
			Promise.resolve(
				[...rows.values()].find(
					(row) =>
						row.ownerId === input.ownerId &&
						row.name === input.name &&
						row.size === input.size &&
						row.status === "uploading"
				) ?? null
			),
		listByOwner: () => Promise.resolve({ items: [], total: 0 }),
	};
}

function makeMeta(seed: KnowledgeDocumentMeta[], calls: string[]) {
	const rows = new Map(seed.map((row) => [row.id, { ...row }]));
	return {
		rows,
		store: {
			...makeMetaReads(rows),
			insert: (
				input: Omit<
					KnowledgeDocumentMeta,
					"id" | "status" | "createdAt" | "updatedAt"
				>
			) => {
				const row: KnowledgeDocumentMeta = {
					...input,
					id: crypto.randomUUID(),
					status: "uploading",
					createdAt: new Date(),
					updatedAt: new Date(),
				};
				rows.set(row.id, row);
				return Promise.resolve(row);
			},
			markReady: (id: string) => {
				const row = rows.get(id);
				if (row) {
					row.status = "ready";
					row.uploadId = null;
				}
				return Promise.resolve(row ?? null);
			},
			delete: (id: string) => {
				calls.push(`db.delete:${id}`);
				rows.delete(id);
				return Promise.resolve();
			},
		},
	};
}

function makeBucket(
	calls: string[],
	overrides: Partial<MultipartBucket> = {},
	parts: MultipartPart[] = []
): MultipartBucket {
	return {
		get: () => Promise.resolve(null),
		put: () => Promise.resolve(),
		delete: (key) => {
			calls.push(`r2.delete:${key}`);
			return Promise.resolve();
		},
		createMultipartUpload: () => Promise.resolve("upload-1"),
		uploadPart: (_key, _uploadId, partNumber, data) =>
			Promise.resolve({
				partNumber,
				etag: `etag-${partNumber}`,
				size: data.byteLength,
			}),
		listParts: () => Promise.resolve(parts),
		completeMultipartUpload: () => Promise.resolve(),
		abortMultipartUpload: (key) => {
			calls.push(`r2.abort:${key}`);
			return Promise.resolve();
		},
		...overrides,
	};
}

function readyDoc(ownerId: string): KnowledgeDocumentMeta {
	return {
		id: "11111111-1111-4111-8111-111111111111",
		ownerId,
		name: "report.pdf",
		mime: "application/pdf",
		size: 10,
		r2Key: "knowledge/owner/abc",
		status: "ready",
		uploadId: null,
		partSize: 8,
		createdAt: new Date(),
		updatedAt: new Date(),
	};
}

function pendingDoc(ownerId: string): KnowledgeDocumentMeta {
	return { ...readyDoc(ownerId), status: "uploading", uploadId: "u1" };
}

const OWNER = "22222222-2222-4222-8222-222222222222";

it("remove deletes the R2 object before the metadata row", async () => {
	const calls: string[] = [];
	const doc = readyDoc(OWNER);
	const meta = makeMeta([doc], calls);
	const store = createKnowledgeStore(meta.store, makeBucket(calls));

	await expect(store.remove(OWNER, doc.id)).resolves.toBe(true);
	expect(calls).toEqual([`r2.delete:${doc.r2Key}`, `db.delete:${doc.id}`]);
});

it("remove keeps the metadata row when the R2 delete fails", async () => {
	const calls: string[] = [];
	const doc = readyDoc(OWNER);
	const meta = makeMeta([doc], calls);
	const store = createKnowledgeStore(
		meta.store,
		makeBucket(calls, { delete: () => Promise.reject(new Error("R2 down")) })
	);

	await expect(store.remove(OWNER, doc.id)).rejects.toThrow("R2 down");
	expect(meta.rows.has(doc.id)).toBe(true);
});

it("remove reads another owner's document as missing", async () => {
	const calls: string[] = [];
	const meta = makeMeta(
		[readyDoc("33333333-3333-4333-8333-333333333333")],
		calls
	);
	const store = createKnowledgeStore(meta.store, makeBucket(calls));

	await expect(store.remove(OWNER, readyDoc(OWNER).id)).resolves.toBe(false);
	expect(calls).toEqual([]);
});

it("remove aborts the multipart upload for an in-flight document", async () => {
	const calls: string[] = [];
	const doc = pendingDoc(OWNER);
	const meta = makeMeta([doc], calls);
	const store = createKnowledgeStore(meta.store, makeBucket(calls));

	await expect(store.remove(OWNER, doc.id)).resolves.toBe(true);
	expect(calls).toEqual([`r2.abort:${doc.r2Key}`, `db.delete:${doc.id}`]);
});

it("initUpload resumes a pending upload with its stored parts", async () => {
	const calls: string[] = [];
	const doc = pendingDoc(OWNER);
	const meta = makeMeta([doc], calls);
	const store = createKnowledgeStore(
		meta.store,
		makeBucket(calls, {}, [{ partNumber: 1, etag: "e1", size: 8 }])
	);

	const session = await store.initUpload({
		ownerId: OWNER,
		name: doc.name,
		mime: doc.mime,
		size: doc.size,
	});
	expect(session.document.id).toBe(doc.id);
	expect(session.uploadedParts).toEqual([{ partNumber: 1, size: 8 }]);
});

it("initUpload starts fresh when the pending session is no longer listable", async () => {
	const calls: string[] = [];
	const doc = pendingDoc(OWNER);
	const meta = makeMeta([doc], calls);
	const store = createKnowledgeStore(
		meta.store,
		makeBucket(calls, {
			listParts: () => Promise.reject(new Error("NoSuchUpload")),
		})
	);

	const session = await store.initUpload({
		ownerId: OWNER,
		name: doc.name,
		mime: doc.mime,
		size: doc.size,
	});
	expect(session.document.id).not.toBe(doc.id);
	expect(session.uploadedParts).toEqual([]);
	expect(meta.rows.has(doc.id)).toBe(false);
});

it("completeUpload rejects when stored bytes don't match the declared size", async () => {
	const calls: string[] = [];
	const doc = pendingDoc(OWNER);
	const meta = makeMeta([doc], calls);
	const store = createKnowledgeStore(
		meta.store,
		makeBucket(calls, {}, [{ partNumber: 1, etag: "e1", size: 4 }])
	);

	await expect(store.completeUpload(OWNER, doc.id)).rejects.toThrow(
		"incomplete"
	);
});

it("completeUpload assembles the parts and marks the row ready", async () => {
	const calls: string[] = [];
	const doc = pendingDoc(OWNER);
	const meta = makeMeta([doc], calls);
	const store = createKnowledgeStore(
		meta.store,
		makeBucket(calls, {}, [
			{ partNumber: 1, etag: "e1", size: 8 },
			{ partNumber: 2, etag: "e2", size: 2 },
		])
	);

	const ready = await store.completeUpload(OWNER, doc.id);
	expect(ready?.status).toBe("ready");
});
