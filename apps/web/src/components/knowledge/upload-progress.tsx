import { Button } from "@better-agent/ui/components/button";
import { RotateCcwIcon, XIcon } from "lucide-react";
import { formatBytes } from "./knowledge-types";
import type { UploadItem } from "./use-document-upload";

const PERCENT = 100;

function ProgressBar({ fraction }: { fraction: number }) {
	return (
		<div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
			<div
				className="h-full rounded-full bg-primary transition-all duration-300"
				style={{ width: `${Math.round(fraction * PERCENT)}%` }}
			/>
		</div>
	);
}

function UploadRow({
	item,
	onCancel,
	onRetry,
}: {
	item: UploadItem;
	onCancel: (id: string) => void;
	onRetry: (id: string) => void;
}) {
	const failed = item.status === "error";
	return (
		<div className="flex flex-col gap-2 rounded-lg bg-muted/40 p-3">
			<div className="flex items-center justify-between gap-3">
				<div className="min-w-0">
					<p className="truncate text-sm">{item.file.name}</p>
					<p className="text-muted-foreground text-xs">
						{failed
							? (item.error ?? "Upload failed")
							: `Uploading… ${Math.round(item.progress * PERCENT)}% of ${formatBytes(item.file.size)}`}
					</p>
				</div>
				{failed ? (
					<div className="flex shrink-0 items-center gap-1">
						<Button
							aria-label="Resume upload"
							onClick={() => onRetry(item.id)}
							size="xs"
							variant="outline"
						>
							<RotateCcwIcon className="size-3.5" />
							Resume
						</Button>
						<Button
							aria-label="Cancel upload"
							onClick={() => onCancel(item.id)}
							size="icon-xs"
							variant="ghost"
						>
							<XIcon className="size-4" />
						</Button>
					</div>
				) : null}
			</div>
			<ProgressBar fraction={item.progress} />
		</div>
	);
}

/** The in-flight/failed uploads above the document list. A failed row keeps
 * its File so "Resume" re-opens the same upload session and only sends the
 * chunks the server doesn't already have. */
export function UploadProgress({
	uploads,
	onCancel,
	onRetry,
}: {
	uploads: UploadItem[];
	onCancel: (id: string) => void;
	onRetry: (id: string) => void;
}) {
	if (uploads.length === 0) {
		return null;
	}
	return (
		<div className="flex flex-col gap-2">
			{uploads.map((item) => (
				<UploadRow
					item={item}
					key={item.id}
					onCancel={onCancel}
					onRetry={onRetry}
				/>
			))}
		</div>
	);
}
