import type { AttachmentRow, AttachmentStore } from "@better-agent/agent/ports";
import type {
	AttachmentMeta,
	AttachmentMetaStore,
} from "@better-agent/db/repositories/attachment-meta-store";

// Minimal object-store shape the attachment store depends on — satisfied by
// the S3-compatible bucket in s3-bucket.ts. (Named R2* for the persisted
// `r2Key` column it pairs with; the runtime is plain S3-over-HTTP.)
export interface R2ObjectBody {
	arrayBuffer(): Promise<ArrayBuffer>;
}
export interface R2Bucket {
	delete(key: string): Promise<void>;
	get(key: string): Promise<R2ObjectBody | null>;
	put(key: string, value: ArrayBuffer | ArrayBufferView): Promise<unknown>;
}

function toRow(meta: AttachmentMeta): AttachmentRow {
	return {
		id: meta.id,
		sessionId: meta.sessionId,
		messageId: meta.messageId,
		mime: meta.mime,
		name: meta.name,
		size: meta.size,
		createdAt: meta.createdAt,
	};
}

/**
 * AttachmentStore backed by Postgres (metadata) + an S3-compatible bucket
 * (bytes). The bucket is optional so the rest of the app works without it;
 * attachment operations throw a clear error when it's missing rather than
 * failing obscurely.
 */
export function createAttachmentStore(
	meta: AttachmentMetaStore,
	bucket: R2Bucket | undefined
): AttachmentStore {
	const requireBucket = (): R2Bucket => {
		if (!bucket) {
			throw new Error(
				"Attachment storage is unavailable (object-store bucket not configured)"
			);
		}
		return bucket;
	};
	return {
		async create(input) {
			const target = requireBucket();
			const key = `attachments/${input.sessionId}/${crypto.randomUUID()}`;
			await target.put(key, input.data);
			const row = await meta.insert({
				sessionId: input.sessionId,
				r2Key: key,
				mime: input.mime,
				name: input.name,
				size: input.data.byteLength,
			});
			return toRow(row);
		},
		async getById(id) {
			const row = await meta.getById(id);
			return row ? toRow(row) : null;
		},
		async getBytes(id) {
			const row = await meta.getById(id);
			if (!row) {
				return null;
			}
			const obj = await requireBucket().get(row.r2Key);
			if (!obj) {
				return null;
			}
			return new Uint8Array(await obj.arrayBuffer());
		},
		linkToMessage(ids, messageId) {
			return meta.linkToMessage(ids, messageId);
		},
		async listByMessage(messageId) {
			const rows = await meta.listByMessage(messageId);
			return rows.map(toRow);
		},
	};
}
