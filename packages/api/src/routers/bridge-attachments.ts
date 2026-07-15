import { ORPCError } from "@orpc/server";
import { z } from "zod";
import { bytesToFile, validateImageUpload } from "../attachments";
import { requireOwnedBridgeSession } from "../bridge/ownership";
import { bridgeProcedure, userProcedure } from "../index";

// P3-T2 (docs/local-agent-workspace-plan.md): image input for local agents.
// The web uploads an image against a BRIDGE session (user plane), the send
// carries `images: [{id, mime, name}]` on the ordinary text command, and the
// bridge CLI downloads the referenced bytes back down (CLI plane) to inject
// them into the agent. Reuses the cloud chat's `attachments` table/store —
// `sessionId` there is a plain uuid column with no FK, so a bridge session id
// slots in unchanged (see packages/db/src/schema/attachments.ts).

/** The attachment store throws a plain `Error` mentioning this when no
 * object-store bucket is configured (see apps/server/src/attachment-store.ts's
 * `requireBucket`) — mapped to a clear SERVICE_UNAVAILABLE instead of a
 * generic 500 so the web can toast something actionable. */
const STORAGE_UNAVAILABLE_MARKER = "unavailable";

function isStorageUnavailable(error: unknown): boolean {
	return (
		error instanceof Error && error.message.includes(STORAGE_UNAVAILABLE_MARKER)
	);
}

const notFound = () =>
	new ORPCError("NOT_FOUND", { message: "Attachment not found" });

/** Web (user plane): validate + store one image against an owned bridge
 * session. Returns the metadata the composer keeps client-side; the bytes
 * only ever come back down via `getBridgeAttachment` (CLI plane). */
export const uploadBridgeAttachment = userProcedure
	.input(z.object({ sessionId: z.uuid(), file: z.instanceof(File) }))
	.handler(async ({ input, context }) => {
		await requireOwnedBridgeSession(
			context,
			context.authedUser.id,
			input.sessionId
		);
		const validated = await validateImageUpload(input.file);
		try {
			const row = await context.services.stores.attachment.create({
				sessionId: input.sessionId,
				data: validated.data,
				mime: validated.mime,
				name: validated.name,
			});
			return { id: row.id, mime: row.mime, name: row.name, size: row.size };
		} catch (error) {
			if (isStorageUnavailable(error)) {
				throw new ORPCError("SERVICE_UNAVAILABLE", {
					message: "Image storage is not configured on this server",
				});
			}
			throw error;
		}
	});

/** Bridge CLI (bridge-token plane): the bytes for one previously-uploaded
 * attachment, as a File (mirrors user-sessions.ts's `getAttachment`).
 * NOT_FOUND for a missing row/object AND for an attachment whose session
 * belongs to another token or user — existence never leaks, same contract as
 * `requireOwnedBridgeSession`. */
export const getBridgeAttachment = bridgeProcedure
	.input(z.object({ attachmentId: z.uuid() }))
	.handler(async ({ input, context }) => {
		const row = await context.services.stores.attachment.getById(
			input.attachmentId
		);
		if (!row) {
			throw notFound();
		}
		const session = await context.services.stores.bridgeSession.get(
			row.sessionId
		);
		const { tokenId, userId } = context.authedBridgeToken;
		if (!session || session.tokenId !== tokenId || session.userId !== userId) {
			throw notFound();
		}
		const bytes = await context.services.stores.attachment.getBytes(
			input.attachmentId
		);
		if (!bytes) {
			throw notFound();
		}
		return bytesToFile(bytes, row.name, row.mime);
	});
