import { Button } from "@better-agent/ui/components/button";
import { Skeleton } from "@better-agent/ui/components/skeleton";
import { useQuery } from "@tanstack/react-query";
import { DownloadIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { client, orpc } from "@/utils/orpc";
import { formatBytes, type KnowledgeDocument } from "./knowledge-types";

// Anything bigger is download-only: the preview fetches the whole object
// through the RPC layer, so an unbounded fetch would stall the drawer.
const PREVIEW_LIMIT_BYTES = 20 * 1024 * 1024;

type PreviewKind = "image" | "none" | "pdf" | "text";

const TEXT_MIMES = new Set(["application/json"]);

// text/* is rendered as plain text (never iframed): a blob: URL shares the
// app's origin, so iframing an uploaded text/html file would execute its
// scripts with access to our storage/tokens.
function previewKind(mime: string): PreviewKind {
	if (mime.startsWith("image/")) {
		return "image";
	}
	if (mime === "application/pdf") {
		return "pdf";
	}
	if (mime.startsWith("text/") || TEXT_MIMES.has(mime)) {
		return "text";
	}
	return "none";
}

function useObjectUrl(file: File | undefined): string | null {
	const [url, setUrl] = useState<string | null>(null);
	useEffect(() => {
		const next = file ? URL.createObjectURL(file) : null;
		setUrl(next);
		return () => {
			if (next) {
				URL.revokeObjectURL(next);
			}
		};
	}, [file]);
	return url;
}

/** Fetch the bytes and hand them to the browser's save-file flow. */
async function saveDocument(doc: KnowledgeDocument): Promise<void> {
	const file = await client.knowledgeBase.download({ documentId: doc.id });
	const url = URL.createObjectURL(file);
	const anchor = document.createElement("a");
	anchor.href = url;
	anchor.download = doc.name;
	anchor.click();
	URL.revokeObjectURL(url);
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
				onClick={() =>
					saveDocument(doc).catch((error: unknown) =>
						toast.error(
							error instanceof Error ? error.message : "Download failed"
						)
					)
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

function PreviewBody({
	doc,
	file,
	kind,
	url,
}: {
	doc: KnowledgeDocument;
	file: File;
	kind: PreviewKind;
	url: string;
}) {
	const text = useQuery({
		queryKey: ["knowledge-preview-text", doc.id],
		queryFn: () => file.text(),
		enabled: kind === "text",
		staleTime: Number.POSITIVE_INFINITY,
	});
	if (kind === "image") {
		return (
			<div className="flex justify-center p-4">
				{/* biome-ignore lint/correctness/useImageSize: intrinsic dimensions are unknown until the uploaded blob loads */}
				<img alt={doc.name} className="max-w-full rounded-lg" src={url} />
			</div>
		);
	}
	if (kind === "pdf") {
		return <iframe className="h-full w-full" src={url} title={doc.name} />;
	}
	if (text.isPending) {
		return <PreviewSkeleton />;
	}
	return (
		<pre className="whitespace-pre-wrap break-words p-4 font-mono text-sm">
			{text.data}
		</pre>
	);
}

/** The drawer body: inline preview for images, PDFs and text; a download
 * prompt for everything else (and for files too large to fetch inline). */
export function DocumentPreview({ doc }: { doc: KnowledgeDocument }) {
	const kind = previewKind(doc.mime);
	const canPreview = kind !== "none" && doc.size <= PREVIEW_LIMIT_BYTES;
	const download = useQuery(
		orpc.knowledgeBase.download.queryOptions({
			input: { documentId: doc.id },
			enabled: canPreview,
			staleTime: Number.POSITIVE_INFINITY,
		})
	);
	const url = useObjectUrl(download.data);

	if (!canPreview) {
		return (
			<DownloadFallback
				doc={doc}
				reason={
					kind === "none"
						? "Preview isn't available for this file type."
						: "This file is too large to preview inline."
				}
			/>
		);
	}
	if (download.isError) {
		return <DownloadFallback doc={doc} reason="The preview failed to load." />;
	}
	if (download.isPending || !(download.data && url)) {
		return <PreviewSkeleton />;
	}
	return <PreviewBody doc={doc} file={download.data} kind={kind} url={url} />;
}
