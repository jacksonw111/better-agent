import type { AttachmentRow, AttachmentStore } from "@better-agent/agent/ports";

// In-memory attachment store fake for the bridge router tests (P3-T2's
// upload/getBridgeAttachment routes) — split out of bridge-test-helpers.ts /
// bridge-test-helpers-stores.ts to keep both under the per-file line cap.

export interface MemoryAttachmentStore extends AttachmentStore {
	/** Flip to false to simulate a server with no object-store bucket
	 * configured — `create`/`getBytes` then throw the same "unavailable" error
	 * the real store's `requireBucket` does (see
	 * apps/server/src/attachment-store.ts). */
	available: boolean;
}

/** The unavailable-bucket error `create`/`getBytes` throw when `available`
 * is flipped off — same wording marker the real store's `requireBucket` uses. */
function storageUnavailable(): Error {
	return new Error(
		"Attachment storage is unavailable (object-store bucket not configured)"
	);
}

function newAttachmentRow(
	input: Parameters<AttachmentStore["create"]>[0]
): AttachmentRow {
	return {
		id: crypto.randomUUID(),
		sessionId: input.sessionId,
		messageId: null,
		mime: input.mime,
		name: input.name,
		size: input.data.byteLength,
		createdAt: new Date(),
	};
}

export function memoryAttachmentStore(): MemoryAttachmentStore {
	const rows = new Map<string, AttachmentRow>();
	const bytes = new Map<string, Uint8Array>();
	const store: MemoryAttachmentStore = {
		available: true,
		create(input) {
			if (!store.available) {
				throw storageUnavailable();
			}
			const row = newAttachmentRow(input);
			rows.set(row.id, row);
			bytes.set(row.id, input.data);
			return Promise.resolve(row);
		},
		getById(id) {
			return Promise.resolve(rows.get(id) ?? null);
		},
		getBytes(id) {
			if (!store.available) {
				throw storageUnavailable();
			}
			return Promise.resolve(bytes.get(id) ?? null);
		},
		linkToMessage(ids, messageId) {
			for (const id of ids) {
				const row = rows.get(id);
				if (row) {
					rows.set(id, { ...row, messageId });
				}
			}
			return Promise.resolve();
		},
		listByMessage(messageId) {
			return Promise.resolve(
				[...rows.values()].filter((row) => row.messageId === messageId)
			);
		},
	};
	return store;
}
