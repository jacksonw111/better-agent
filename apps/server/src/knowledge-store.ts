import {
	KNOWLEDGE_PART_SIZE,
	type KnowledgeDocumentRow,
	type KnowledgeStore,
} from "@better-agent/agent/knowledge-ports";
import type {
	KnowledgeDocumentMeta,
	KnowledgeDocumentMetaStore,
} from "@better-agent/db/repositories/knowledge-document-store";
import type { R2Bucket } from "./attachment-store";

/** One stored part of an in-flight multipart upload. */
export interface MultipartPart {
	etag: string;
	partNumber: number;
	size: number;
}

/** The multipart-upload surface the resumable Knowledge Base upload needs on
 * top of the plain object ops — implemented by s3-bucket.ts against R2's S3
 * endpoint. `getStream` exists so the content route can pipe large objects to
 * the browser without buffering them in server memory. */
export interface MultipartBucket extends R2Bucket {
	abortMultipartUpload(key: string, uploadId: string): Promise<void>;
	completeMultipartUpload(
		key: string,
		uploadId: string,
		parts: Pick<MultipartPart, "etag" | "partNumber">[]
	): Promise<void>;
	/** Returns the multipart upload id. */
	createMultipartUpload(key: string, mime: string): Promise<string>;
	getStream(key: string): Promise<ReadableStream<Uint8Array> | null>;
	listParts(key: string, uploadId: string): Promise<MultipartPart[]>;
	uploadPart(
		key: string,
		uploadId: string,
		partNumber: number,
		data: Uint8Array
	): Promise<MultipartPart>;
}

function toRow(meta: KnowledgeDocumentMeta): KnowledgeDocumentRow {
	return {
		id: meta.id,
		ownerId: meta.ownerId,
		name: meta.name,
		mime: meta.mime,
		size: meta.size,
		status: meta.status,
		partSize: meta.partSize,
		createdAt: meta.createdAt,
		updatedAt: meta.updatedAt,
	};
}

/** The pending row's multipart upload id — rows in `uploading` always carry
 * one; a missing value means the row is corrupt, not resumable. */
function requireUploadId(meta: KnowledgeDocumentMeta): string {
	if (!meta.uploadId) {
		throw new Error(`Knowledge document ${meta.id} has no upload in flight`);
	}
	return meta.uploadId;
}

async function openSession(
	bucket: MultipartBucket,
	meta: KnowledgeDocumentMetaStore,
	pending: KnowledgeDocumentMeta
) {
	try {
		const parts = await bucket.listParts(
			pending.r2Key,
			requireUploadId(pending)
		);
		return {
			document: toRow(pending),
			uploadedParts: parts.map((part) => ({
				partNumber: part.partNumber,
				size: part.size,
			})),
		};
	} catch {
		// The multipart upload expired or was aborted out-of-band — the row is
		// unresumable, so drop it and let the caller start fresh.
		await meta.delete(pending.id);
		return null;
	}
}

// The upload-session ops, split into their own factory so createKnowledgeStore
// stays under the repo's max-lines-per-function gate.
function makeUploadOps(
	meta: KnowledgeDocumentMetaStore,
	requireBucket: () => MultipartBucket
): Pick<KnowledgeStore, "initUpload" | "uploadPart"> {
	return {
		async initUpload(input) {
			const target = requireBucket();
			const pending = await meta.findPendingUpload(input);
			if (pending) {
				const resumed = await openSession(target, meta, pending);
				if (resumed) {
					return resumed;
				}
			}
			const key = `knowledge/${input.ownerId}/${crypto.randomUUID()}`;
			const uploadId = await target.createMultipartUpload(key, input.mime);
			const row = await meta.insert({
				ownerId: input.ownerId,
				name: input.name,
				mime: input.mime,
				size: input.size,
				r2Key: key,
				uploadId,
				partSize: KNOWLEDGE_PART_SIZE,
			});
			return { document: toRow(row), uploadedParts: [] };
		},

		async uploadPart(input) {
			const row = await meta.getByIdForOwner(input.ownerId, input.documentId);
			if (row?.status !== "uploading") {
				return false;
			}
			await requireBucket().uploadPart(
				row.r2Key,
				requireUploadId(row),
				input.partNumber,
				input.data
			);
			return true;
		},
	};
}

// The upload-finalisation ops, factored out for the same max-lines reason.
function makeFinishOps(
	meta: KnowledgeDocumentMetaStore,
	requireBucket: () => MultipartBucket
): Pick<KnowledgeStore, "abortUpload" | "completeUpload"> {
	return {
		async completeUpload(ownerId, documentId) {
			const row = await meta.getByIdForOwner(ownerId, documentId);
			if (!row) {
				return null;
			}
			if (row.status === "ready") {
				return toRow(row);
			}
			const target = requireBucket();
			const uploadId = requireUploadId(row);
			const parts = await target.listParts(row.r2Key, uploadId);
			const storedBytes = parts.reduce((sum, part) => sum + part.size, 0);
			if (storedBytes !== row.size) {
				throw new Error(
					`Upload incomplete: ${storedBytes} of ${row.size} bytes stored`
				);
			}
			await target.completeMultipartUpload(row.r2Key, uploadId, parts);
			const ready = await meta.markReady(row.id);
			return ready ? toRow(ready) : null;
		},

		async abortUpload(ownerId, documentId) {
			const row = await meta.getByIdForOwner(ownerId, documentId);
			if (row?.status !== "uploading") {
				return false;
			}
			await requireBucket().abortMultipartUpload(
				row.r2Key,
				requireUploadId(row)
			);
			await meta.delete(row.id);
			return true;
		},
	};
}

// The read ops, factored out for the same max-lines reason.
function makeReadOps(
	meta: KnowledgeDocumentMetaStore,
	requireBucket: () => MultipartBucket
): Pick<KnowledgeStore, "getById" | "getBytes" | "getContent" | "list"> {
	return {
		async getContent(ownerId, documentId) {
			const row = await meta.getByIdForOwner(ownerId, documentId);
			if (row?.status !== "ready") {
				return null;
			}
			const body = await requireBucket().getStream(row.r2Key);
			if (!body) {
				return null;
			}
			return { document: toRow(row), body };
		},
		async getById(ownerId, documentId) {
			const row = await meta.getByIdForOwner(ownerId, documentId);
			return row ? toRow(row) : null;
		},

		async getBytes(ownerId, documentId) {
			const row = await meta.getByIdForOwner(ownerId, documentId);
			if (row?.status !== "ready") {
				return null;
			}
			const obj = await requireBucket().get(row.r2Key);
			if (!obj) {
				return null;
			}
			return {
				document: toRow(row),
				data: new Uint8Array(await obj.arrayBuffer()),
			};
		},

		async list(input) {
			const page = await meta.listByOwner(input);
			return { items: page.items.map(toRow), total: page.total };
		},
	};
}

/**
 * KnowledgeStore backed by Postgres (metadata) + an S3-compatible bucket
 * (bytes), mirroring attachment-store.ts. The bucket is optional so the rest
 * of the app works without it; knowledge operations throw a clear error when
 * it's missing rather than failing obscurely.
 */
export function createKnowledgeStore(
	meta: KnowledgeDocumentMetaStore,
	bucket: MultipartBucket | undefined
): KnowledgeStore {
	const requireBucket = (): MultipartBucket => {
		if (!bucket) {
			throw new Error(
				"Knowledge storage is unavailable (object-store bucket not configured)"
			);
		}
		return bucket;
	};

	return {
		...makeUploadOps(meta, requireBucket),
		...makeFinishOps(meta, requireBucket),
		...makeReadOps(meta, requireBucket),

		// Object storage FIRST, then the row: if the storage delete throws, the
		// row survives and the delete can be retried; the object is never left
		// orphaned behind a vanished row.
		async remove(ownerId, documentId) {
			const row = await meta.getByIdForOwner(ownerId, documentId);
			if (!row) {
				return false;
			}
			const target = requireBucket();
			if (row.status === "uploading") {
				await target.abortMultipartUpload(row.r2Key, requireUploadId(row));
			} else {
				await target.delete(row.r2Key);
			}
			await meta.delete(row.id);
			return true;
		},
	};
}
