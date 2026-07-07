import type { AgentClient } from "@jacksonw111/agent-client";
import { FileIcon } from "lucide-react";
import { useEffect, useState } from "react";

import type { AttachmentRef } from "./chat-blocks";

/** Fetch an attachment through the (token-scoped) Agent client and expose it as
 * an object URL, revoked on unmount. Returns null until loaded or if disabled. */
function useAttachmentUrl(
	agentClient: AgentClient,
	attachmentId: string,
	enabled: boolean
): string | null {
	const [url, setUrl] = useState<string | null>(null);
	useEffect(() => {
		let active = true;
		let objectUrl: string | null = null;
		if (enabled) {
			agentClient
				.getAttachment(attachmentId)
				.then((blob) => {
					if (active) {
						objectUrl = URL.createObjectURL(blob);
						setUrl(objectUrl);
					}
				})
				.catch(() => {
					// Best-effort: the image just won't render.
				});
		}
		return () => {
			active = false;
			if (objectUrl) {
				URL.revokeObjectURL(objectUrl);
			}
		};
	}, [attachmentId, enabled, agentClient]);
	return url;
}

/** Render an uploaded attachment: images inline, other files as a labeled chip. */
export function AttachmentImage({
	file,
	agentClient,
}: {
	file: AttachmentRef;
	agentClient: AgentClient;
}) {
	const isImage = file.mime.startsWith("image/");
	const url = useAttachmentUrl(agentClient, file.attachmentId, isImage);

	if (!isImage) {
		return (
			<div className="flex items-center gap-2 rounded-lg border bg-card px-2.5 py-1.5 text-muted-foreground text-xs">
				<FileIcon className="size-4" />
				<span className="truncate">{file.name}</span>
			</div>
		);
	}
	if (url === null) {
		return <div className="size-32 animate-pulse rounded-lg bg-muted" />;
	}
	return (
		// biome-ignore lint/correctness/useImageSize: object-URL blob of unknown intrinsic dimensions
		<img
			alt={file.name}
			className="max-h-48 max-w-full rounded-lg border object-contain"
			src={url}
		/>
	);
}
