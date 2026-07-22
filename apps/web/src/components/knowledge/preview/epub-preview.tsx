import { useQuery } from "@tanstack/react-query";
import { lazy, Suspense, useState } from "react";
import type { KnowledgeDocument } from "../knowledge-types";
import { fetchDocumentBytes } from "./fetch-bytes";
import { DownloadFallback, PreviewSkeleton } from "./preview-chrome";

// EPUB preview via react-reader/epub.js. Chapters render inside epub.js's
// own iframes, which stay script-free because `allowScriptedContent` is never
// set — an EPUB's XHTML can't run code in (or out of) the app origin.

const ReactReader = lazy(() =>
	import("react-reader").then((mod) => ({ default: mod.ReactReader }))
);

export default function EpubPreview({ doc }: { doc: KnowledgeDocument }) {
	const [location, setLocation] = useState<string | number>(0);
	const bytes = useQuery({
		queryKey: ["knowledge-epub", doc.id],
		queryFn: () => fetchDocumentBytes(doc.id),
		staleTime: Number.POSITIVE_INFINITY,
	});
	if (bytes.isError) {
		return <DownloadFallback doc={doc} reason="The preview failed to load." />;
	}
	if (bytes.isPending) {
		return <PreviewSkeleton />;
	}
	return (
		<div className="h-full">
			<Suspense fallback={<PreviewSkeleton />}>
				<ReactReader
					location={location}
					locationChanged={setLocation}
					title={doc.name}
					url={bytes.data}
				/>
			</Suspense>
		</div>
	);
}
