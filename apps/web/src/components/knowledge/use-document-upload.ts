import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { client, orpc } from "@/utils/orpc";

// Resumable (断点续传) upload against the knowledgeBase router. The file is
// sliced into the server-mandated fixed part size and sent chunk by chunk;
// initUpload reports the parts a previous attempt already stored, so a retry
// — or re-selecting the same file after a reload — skips straight to the
// missing chunks instead of starting over.

/** Must match the router's MAX_DOCUMENT_BYTES (knowledge-base.ts). */
const MAX_DOCUMENT_BYTES = 200 * 1024 * 1024;

export interface UploadItem {
	/** Set once initUpload has opened a session (used by cancel/abort). */
	documentId: string | null;
	error: string | null;
	file: File;
	id: string;
	/** 0..1, counted in stored parts. */
	progress: number;
	status: "error" | "uploading";
}

async function runUpload(
	file: File,
	onSession: (documentId: string) => void,
	onProgress: (fraction: number) => void
): Promise<void> {
	const { document, uploadedParts } = await client.knowledgeBase.initUpload({
		name: file.name,
		mime: file.type || "application/octet-stream",
		size: file.size,
	});
	onSession(document.id);
	const stored = new Set(uploadedParts.map((part) => part.partNumber));
	const partCount = Math.max(1, Math.ceil(file.size / document.partSize));
	onProgress(stored.size / partCount);
	for (let partNumber = 1; partNumber <= partCount; partNumber++) {
		if (stored.has(partNumber)) {
			continue;
		}
		const start = (partNumber - 1) * document.partSize;
		const chunk = file.slice(
			start,
			Math.min(start + document.partSize, file.size)
		);
		await client.knowledgeBase.uploadPart({
			documentId: document.id,
			partNumber,
			chunk: new File([chunk], file.name),
		});
		stored.add(partNumber);
		onProgress(stored.size / partCount);
	}
	await client.knowledgeBase.completeUpload({ documentId: document.id });
}

function validate(file: File): string | null {
	if (file.size === 0) {
		return "Empty files can't be uploaded";
	}
	if (file.size > MAX_DOCUMENT_BYTES) {
		return "Files over 200 MB aren't supported";
	}
	return null;
}

interface UploadTrackerOps {
	add: (item: UploadItem) => void;
	invalidate: () => Promise<void>;
	patch: (id: string, changes: Partial<UploadItem>) => void;
	remove: (id: string) => void;
}

// Runs one tracked upload to completion, keeping the item's row in sync;
// module-level so useDocumentUpload stays under the max-lines gate.
async function runTracked(id: string, file: File, ops: UploadTrackerOps) {
	try {
		await runUpload(
			file,
			(documentId) => ops.patch(id, { documentId }),
			(progress) => ops.patch(id, { progress })
		);
		ops.remove(id);
		toast.success(`Uploaded ${file.name}`);
		await ops.invalidate();
	} catch (error) {
		ops.patch(id, {
			status: "error",
			error: error instanceof Error ? error.message : "Upload failed",
		});
	}
}

function startUpload(file: File, ops: UploadTrackerOps) {
	const invalid = validate(file);
	if (invalid) {
		toast.error(invalid);
		return;
	}
	const item: UploadItem = {
		id: crypto.randomUUID(),
		file,
		documentId: null,
		progress: 0,
		status: "uploading",
		error: null,
	};
	ops.add(item);
	runTracked(item.id, file, ops);
}

/** Drop an upload row and discard its stored parts server-side. */
function cancelUpload(item: UploadItem | undefined, ops: UploadTrackerOps) {
	if (!item) {
		return;
	}
	ops.remove(item.id);
	if (item.documentId) {
		client.knowledgeBase
			.abortUpload({ documentId: item.documentId })
			.catch(() => {
				// Best-effort: an orphaned pending upload is still resumable later.
			});
	}
}

export function useDocumentUpload() {
	const [uploads, setUploads] = useState<UploadItem[]>([]);
	const queryClient = useQueryClient();

	const ops: UploadTrackerOps = {
		add: (item) => setUploads((prev) => [...prev, item]),
		patch: (id, changes) =>
			setUploads((prev) =>
				prev.map((item) => (item.id === id ? { ...item, ...changes } : item))
			),
		remove: (id) => setUploads((prev) => prev.filter((item) => item.id !== id)),
		invalidate: () =>
			queryClient.invalidateQueries({
				queryKey: orpc.knowledgeBase.list.key(),
			}),
	};

	/** Resume an errored upload — initUpload re-opens the same session, so only
	 * the missing parts are re-sent. */
	const retry = (id: string) => {
		const item = uploads.find((upload) => upload.id === id);
		if (!item) {
			return;
		}
		ops.patch(id, { status: "uploading", error: null });
		runTracked(id, item.file, ops);
	};

	return {
		uploads,
		retry,
		start: (file: File) => startUpload(file, ops),
		cancel: (id: string) =>
			cancelUpload(
				uploads.find((upload) => upload.id === id),
				ops
			),
	};
}
