import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import type { KnowledgeDocument } from "../knowledge-types";
import { fetchDocumentBytes } from "./fetch-bytes";
import { DownloadFallback, PreviewSkeleton } from "./preview-chrome";

// Word preview via docx-preview, which builds DOM programmatically from the
// docx XML (it never injects raw user HTML) — EXCEPT altChunk parts, which
// embed arbitrary HTML and are therefore explicitly disabled below. Pages
// render on a white sheet like the PDF viewer, in both themes.

export default function DocxPreview({ doc }: { doc: KnowledgeDocument }) {
	const containerRef = useRef<HTMLDivElement>(null);
	const bytes = useQuery({
		queryKey: ["knowledge-docx", doc.id],
		queryFn: () => fetchDocumentBytes(doc.id),
		staleTime: Number.POSITIVE_INFINITY,
	});

	useEffect(() => {
		const container = containerRef.current;
		const data = bytes.data;
		let active = true;
		if (data && container) {
			import("docx-preview")
				.then(({ renderAsync }) =>
					active
						? renderAsync(data, container, undefined, {
								// Security: altChunks are raw embedded HTML — never render.
								renderAltChunks: false,
								inWrapper: true,
								ignoreLastRenderedPageBreak: true,
							})
						: undefined
				)
				.catch(() => {
					// Fetch-path errors surface via the fallback below; this only
					// guards render races against unmount.
				});
		}
		return () => {
			active = false;
			container?.replaceChildren();
		};
	}, [bytes.data]);

	if (bytes.isError) {
		return <DownloadFallback doc={doc} reason="The preview failed to load." />;
	}
	if (bytes.isPending) {
		return <PreviewSkeleton />;
	}
	return (
		<div className="h-full overflow-auto bg-muted/40 p-4">
			<div
				className="knowledge-docx-preview mx-auto w-fit max-w-full"
				ref={containerRef}
			/>
		</div>
	);
}
