import { Button } from "@better-agent/ui/components/button";
import { Skeleton } from "@better-agent/ui/components/skeleton";
import { formatBytes } from "@better-agent/ui/lib/format-bytes";
import { DownloadIcon } from "lucide-react";
import { documentContentUrl } from "../content-url";
import type { KnowledgeDocument } from "../knowledge-types";

// Shared chrome for every preview viewer: the download fallback and the
// loading skeleton. Lives outside document-preview.tsx so lazy viewers can
// import it without a circular dependency through the registry.

export function DownloadFallback({
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

export function PreviewSkeleton() {
	return (
		<div className="flex flex-col gap-3 p-4">
			<Skeleton className="h-4 w-2/3" />
			<Skeleton className="h-4 w-full" />
			<Skeleton className="h-64 w-full rounded-lg" />
		</div>
	);
}
