import { Button } from "@better-agent/ui/components/button";
import { Skeleton } from "@better-agent/ui/components/skeleton";
import { formatBytes } from "@better-agent/ui/lib/format-bytes";
import { useQuery } from "@tanstack/react-query";
import { DownloadIcon } from "lucide-react";
import { useState } from "react";
import { client } from "@/utils/orpc";
import { documentContentUrl } from "./content-url";
import type { KnowledgeDocument } from "./knowledge-types";

// Images and PDFs stream progressively off the authed content route (no size
// cap — same approach as the finance report viewer). Only the plain-text
// preview still materialises the whole file client-side, so it alone keeps a
// cap and falls back to download beyond it.
const TEXT_PREVIEW_LIMIT_BYTES = 5 * 1024 * 1024;

type PreviewKind = "image" | "none" | "text";

const TEXT_MIMES = new Set(["application/json"]);

// text/* is rendered as plain text (never iframed): a blob:/streamed URL
// shares the app's origin, so iframing an uploaded text/html file would
// execute its scripts with access to our storage/tokens.
function previewKind(mime: string): PreviewKind {
	if (mime.startsWith("image/")) {
		return "image";
	}
	if (mime.startsWith("text/") || TEXT_MIMES.has(mime)) {
		return "text";
	}
	return "none";
}

function DownloadFallback({
	doc,
	reason,
}: {
	doc: KnowledgeDocument;
	reason: string;
}) {
	return (
		<div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
			<p className="text-muted-foreground text-sm">{reason}</p>
			<Button
				render={
					// biome-ignore lint/a11y/useAnchorContent: Button injects the children into the anchor
					<a href={documentContentUrl(doc.id, { download: true })} />
				}
				variant="outline"
			>
				<DownloadIcon className="size-4" />
				Download ({formatBytes(doc.size)})
			</Button>
		</div>
	);
}

function PreviewSkeleton() {
	return (
		<div className="flex flex-col gap-3 p-4">
			<Skeleton className="h-4 w-2/3" />
			<Skeleton className="h-4 w-full" />
			<Skeleton className="h-64 w-full rounded-lg" />
		</div>
	);
}

function ImagePreview({ doc }: { doc: KnowledgeDocument }) {
	const [failed, setFailed] = useState(false);
	if (failed) {
		return <DownloadFallback doc={doc} reason="The preview failed to load." />;
	}
	return (
		<div className="flex justify-center p-4">
			{/* biome-ignore lint/correctness/useImageSize: intrinsic dimensions are unknown until the uploaded file loads */}
			{/* biome-ignore lint/a11y/noNoninteractiveElementInteractions: onError is a load-failure handler, not an interaction */}
			<img
				alt={doc.name}
				className="max-w-full rounded-lg"
				onError={() => setFailed(true)}
				src={documentContentUrl(doc.id)}
			/>
		</div>
	);
}

function TextPreview({ doc }: { doc: KnowledgeDocument }) {
	const text = useQuery({
		queryKey: ["knowledge-preview-text", doc.id],
		queryFn: async () => {
			const file = await client.knowledgeBase.download({ documentId: doc.id });
			return file.text();
		},
		staleTime: Number.POSITIVE_INFINITY,
	});
	if (text.isPending) {
		return <PreviewSkeleton />;
	}
	if (text.isError) {
		return <DownloadFallback doc={doc} reason="The preview failed to load." />;
	}
	return (
		<pre className="whitespace-pre-wrap break-words p-4 font-mono text-sm">
			{text.data}
		</pre>
	);
}

/** The drawer body for non-PDF documents: streamed image preview, inline text
 * up to a cap, and a download prompt for everything else. (PDFs never reach
 * here — the drawer renders the full PdfViewerSrc for those.) */
export function DocumentPreview({ doc }: { doc: KnowledgeDocument }) {
	const kind = previewKind(doc.mime);
	if (kind === "image") {
		return <ImagePreview doc={doc} />;
	}
	if (kind === "text") {
		if (doc.size > TEXT_PREVIEW_LIMIT_BYTES) {
			return (
				<DownloadFallback
					doc={doc}
					reason="This file is too large to preview inline."
				/>
			);
		}
		return <TextPreview doc={doc} />;
	}
	return (
		<DownloadFallback
			doc={doc}
			reason="Preview isn't available for this file type."
		/>
	);
}
