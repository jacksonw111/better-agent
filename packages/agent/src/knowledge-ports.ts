// Knowledge Base port types, in their own file (like memory-ports.ts) so
// ports.ts stays under the repo's 300-line limit.
//
// A knowledge document is a user-uploaded file: bytes live in object storage
// (R2), metadata in Postgres. Uploads are resumable — a document starts in
// `uploading` (a multipart upload is in flight) and flips to `ready` when the
// client completes it. Owner scoping is enforced here by every method taking
// an ownerId: a document that exists but belongs to someone else reads as
// missing (null/false), so existence never leaks across users.

// R2's S3 multipart API requires every part except the last to be at least
// 5 MiB and all non-last parts equal-sized; 8 MiB keeps chunk requests small
// while clearing that floor. Shared here so the API layer's per-chunk size
// validation and the server's upload sessions can't drift.
export const KNOWLEDGE_PART_SIZE = 8 * 1024 * 1024;

export type KnowledgeDocumentStatus = "ready" | "uploading";

/** A knowledge document's public metadata (storage key + multipart id stay
 * server-internal). */
export interface KnowledgeDocumentRow {
	createdAt: Date;
	id: string;
	mime: string;
	name: string;
	ownerId: string;
	/** Fixed chunk size (bytes) every part of this upload must use. */
	partSize: number;
	size: number;
	status: KnowledgeDocumentStatus;
	updatedAt: Date;
}

/** A multipart part already persisted in object storage — what an interrupted
 * upload resumes from. */
export interface UploadedPart {
	partNumber: number;
	size: number;
}

/** An open (or freshly created) upload: the document row plus the parts the
 * client can skip re-sending. */
export interface KnowledgeUploadSession {
	document: KnowledgeDocumentRow;
	uploadedParts: UploadedPart[];
}

export interface KnowledgeDocumentPage {
	items: KnowledgeDocumentRow[];
	total: number;
}

export interface KnowledgeStore {
	/** Abort an in-flight upload: discards the multipart upload in object
	 * storage first, then the metadata row. */
	abortUpload(ownerId: string, documentId: string): Promise<boolean>;
	/** Assemble the uploaded parts into the final object and mark the document
	 * ready. Throws if the persisted parts don't add up to the declared size. */
	completeUpload(
		ownerId: string,
		documentId: string
	): Promise<KnowledgeDocumentRow | null>;
	getById(
		ownerId: string,
		documentId: string
	): Promise<KnowledgeDocumentRow | null>;
	/** The full object bytes of a ready document (null while uploading). */
	getBytes(
		ownerId: string,
		documentId: string
	): Promise<{ data: Uint8Array; document: KnowledgeDocumentRow } | null>;
	/** Start — or resume — an upload. A pending document with the same owner,
	 * name and size is treated as the same interrupted upload and returned with
	 * its already-stored parts. */
	initUpload(input: {
		mime: string;
		name: string;
		ownerId: string;
		size: number;
	}): Promise<KnowledgeUploadSession>;
	/** Ready documents only, newest first, with optional name search. */
	list(input: {
		limit: number;
		offset: number;
		ownerId: string;
		search?: string;
	}): Promise<KnowledgeDocumentPage>;
	/** Delete a document — object storage FIRST, then the metadata row, so a
	 * failed storage delete leaves the row (and a retryable delete) behind
	 * rather than an orphaned object. */
	remove(ownerId: string, documentId: string): Promise<boolean>;
	/** Persist one fixed-size chunk of an in-flight upload. */
	uploadPart(input: {
		data: Uint8Array;
		documentId: string;
		ownerId: string;
		partNumber: number;
	}): Promise<boolean>;
}
