import { KNOWLEDGE_PART_SIZE } from "@better-agent/agent/knowledge-ports";
import { ORPCError } from "@orpc/server";
import { z } from "zod";
import { bytesToFile } from "../attachments";
import { userProcedure } from "../index";

// The Knowledge Base router: a per-user document library. Bytes live in R2
// (via the server's KnowledgeStore), metadata in Postgres. Uploads are
// resumable: initUpload opens (or re-opens) a multipart upload session,
// uploadPart streams fixed-size chunks, completeUpload assembles them — an
// interrupted upload resumes by calling initUpload again with the same
// name+size and skipping the parts it reports as already stored.

const MAX_NAME_LEN = 200;
const MAX_MIME_LEN = 120;
const MAX_SEARCH_LEN = 200;
const MAX_DOCUMENT_BYTES = 200 * 1024 * 1024; // 200 MB
const MAX_PAGE_SIZE = 50;
const DEFAULT_PAGE_SIZE = 20;
// S3 multipart caps uploads at 10k parts; with our fixed part size the
// document-size cap is hit long before this is.
const MAX_PART_NUMBER = 10_000;

const documentIdInput = z.object({ documentId: z.uuid() });

const listInput = z.object({
	page: z.number().int().min(0).default(0),
	pageSize: z
		.number()
		.int()
		.min(1)
		.max(MAX_PAGE_SIZE)
		.default(DEFAULT_PAGE_SIZE),
	search: z.string().trim().max(MAX_SEARCH_LEN).optional(),
});

const initUploadInput = z.object({
	name: z.string().trim().min(1).max(MAX_NAME_LEN),
	mime: z.string().trim().min(1).max(MAX_MIME_LEN),
	size: z.number().int().min(1).max(MAX_DOCUMENT_BYTES),
});

const uploadPartInput = z.object({
	documentId: z.uuid(),
	partNumber: z.number().int().min(1).max(MAX_PART_NUMBER),
	chunk: z.instanceof(File),
});

const notFound = () =>
	new ORPCError("NOT_FOUND", { message: "Document not found" });

/** The knowledge store throws a plain `Error` mentioning this when no
 * object-store bucket is configured (same contract as attachment-store.ts) —
 * mapped to a clear SERVICE_UNAVAILABLE instead of a generic 500 so the web
 * can toast something actionable. */
const STORAGE_UNAVAILABLE_MARKER = "unavailable";

function mapStorageError(error: unknown): never {
	if (
		error instanceof Error &&
		error.message.includes(STORAGE_UNAVAILABLE_MARKER)
	) {
		throw new ORPCError("SERVICE_UNAVAILABLE", {
			message: "Document storage is not configured on this server",
		});
	}
	throw error;
}

export const knowledgeBaseRouter = {
	list: userProcedure.input(listInput).handler(async ({ input, context }) => {
		const page = await context.services.stores.knowledge.list({
			ownerId: context.authedUser.id,
			search: input.search || undefined,
			limit: input.pageSize,
			offset: input.page * input.pageSize,
		});
		return { ...page, page: input.page, pageSize: input.pageSize };
	}),

	initUpload: userProcedure
		.input(initUploadInput)
		.handler(({ input, context }) =>
			context.services.stores.knowledge
				.initUpload({ ...input, ownerId: context.authedUser.id })
				.catch(mapStorageError)
		),

	uploadPart: userProcedure
		.input(uploadPartInput)
		.handler(async ({ input, context }) => {
			if (input.chunk.size < 1 || input.chunk.size > KNOWLEDGE_PART_SIZE) {
				throw new ORPCError("BAD_REQUEST", {
					message: `Chunk must be 1..${KNOWLEDGE_PART_SIZE} bytes`,
				});
			}
			const data = new Uint8Array(await input.chunk.arrayBuffer());
			const stored = await context.services.stores.knowledge
				.uploadPart({
					ownerId: context.authedUser.id,
					documentId: input.documentId,
					partNumber: input.partNumber,
					data,
				})
				.catch(mapStorageError);
			if (!stored) {
				throw notFound();
			}
			return { ok: true };
		}),

	completeUpload: userProcedure
		.input(documentIdInput)
		.handler(async ({ input, context }) => {
			const document = await context.services.stores.knowledge
				.completeUpload(context.authedUser.id, input.documentId)
				.catch((error: unknown) => {
					if (error instanceof Error && error.message.includes("incomplete")) {
						throw new ORPCError("BAD_REQUEST", { message: error.message });
					}
					return mapStorageError(error);
				});
			if (!document) {
				throw notFound();
			}
			return document;
		}),

	abortUpload: userProcedure
		.input(documentIdInput)
		.handler(async ({ input, context }) => {
			await context.services.stores.knowledge
				.abortUpload(context.authedUser.id, input.documentId)
				.catch(mapStorageError);
			return { ok: true };
		}),

	/** The document's bytes as a File — the drawer preview and the download
	 * button both come through here (owner-scoped, never a public URL). */
	download: userProcedure
		.input(documentIdInput)
		.handler(async ({ input, context }) => {
			const result = await context.services.stores.knowledge
				.getBytes(context.authedUser.id, input.documentId)
				.catch(mapStorageError);
			if (!result) {
				throw notFound();
			}
			return bytesToFile(
				result.data,
				result.document.name,
				result.document.mime
			);
		}),

	/** Deletes R2 first, then the metadata row (see KnowledgeStore.remove): a
	 * failed storage delete keeps the row so the delete stays retryable. */
	delete: userProcedure
		.input(documentIdInput)
		.handler(async ({ input, context }) => {
			const removed = await context.services.stores.knowledge
				.remove(context.authedUser.id, input.documentId)
				.catch(mapStorageError);
			if (!removed) {
				throw notFound();
			}
			return { ok: true };
		}),
};
