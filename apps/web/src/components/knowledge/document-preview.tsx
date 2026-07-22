import { Suspense } from "react";
import type { KnowledgeDocument } from "./knowledge-types";
import { DownloadFallback, PreviewSkeleton } from "./preview/preview-chrome";
import { resolvePreview } from "./preview/registry";

/** The drawer body for non-PDF documents, backed by the preview registry
 * (images, CSV, XLSX, DOCX, EPUB, text/code — see preview/registry.ts).
 * Unknown formats and files over a provider's byte cap fall back to
 * download instead of a slow or broken preview. */
export function DocumentPreview({ doc }: { doc: KnowledgeDocument }) {
	const provider = resolvePreview(doc);
	if (!provider) {
		return (
			<DownloadFallback
				doc={doc}
				reason="Preview isn't available for this file type."
			/>
		);
	}
	if (doc.size > provider.maxBytes) {
		return (
			<DownloadFallback
				doc={doc}
				reason="This file is too large to preview inline."
			/>
		);
	}
	const Viewer = provider.Component;
	return (
		<Suspense fallback={<PreviewSkeleton />}>
			<Viewer doc={doc} />
		</Suspense>
	);
}
