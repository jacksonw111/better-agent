"use client";

import { formatBytes } from "@better-agent/ui/lib/format-bytes";
import { cn } from "@better-agent/ui/lib/utils";
import { CheckCircle2Icon, FileIcon, RotateCcwIcon, XIcon } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";

import { Button } from "./button";

// Generic, protocol-agnostic upload list: animated rows for in-flight items.
// Pairs with dropzone.tsx; consumers own the actual upload protocol
// (single-shot, chunked, resumable …) and just feed items in.

export type UploadItemStatus = "done" | "error" | "uploading";

export interface UploadListItem {
	error?: string | null;
	id: string;
	name: string;
	/** 0..1, in whatever unit the protocol tracks (bytes, parts …). */
	progress: number;
	size: number;
	status: UploadItemStatus;
}

const PERCENT = 100;

function UploadErrorActions({
	item,
	onCancel,
	onRetry,
}: {
	item: UploadListItem;
	onCancel?: (id: string) => void;
	onRetry?: (id: string) => void;
}) {
	return (
		<span className="flex items-center gap-1">
			{onRetry ? (
				<Button
					aria-label="Resume upload"
					onClick={() => onRetry(item.id)}
					size="xs"
					variant="outline"
				>
					<RotateCcwIcon className="size-3.5" />
					Resume
				</Button>
			) : null}
			{onCancel ? (
				<Button
					aria-label="Cancel upload"
					onClick={() => onCancel(item.id)}
					size="icon-xs"
					variant="ghost"
				>
					<XIcon className="size-4" />
				</Button>
			) : null}
		</span>
	);
}

function UploadItemActions({
	item,
	onCancel,
	onRetry,
}: {
	item: UploadListItem;
	onCancel?: (id: string) => void;
	onRetry?: (id: string) => void;
}) {
	if (item.status === "done") {
		return (
			<motion.span
				animate={{ opacity: 1, scale: 1 }}
				className="flex items-center gap-1 text-emerald-600 text-xs dark:text-emerald-400"
				initial={{ opacity: 0, scale: 0.6 }}
			>
				<CheckCircle2Icon className="size-4" />
				Done
			</motion.span>
		);
	}
	if (item.status === "error") {
		return (
			<UploadErrorActions item={item} onCancel={onCancel} onRetry={onRetry} />
		);
	}
	return (
		<span className="text-muted-foreground text-xs tabular-nums">
			{Math.round(item.progress * PERCENT)}%
		</span>
	);
}

function UploadProgressBar({ item }: { item: UploadListItem }) {
	const fraction = item.status === "done" ? 1 : item.progress;
	return (
		<div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
			<div
				className={cn(
					"h-full rounded-full bg-primary transition-all duration-300",
					item.status === "done" && "bg-emerald-500",
					item.status === "error" && "bg-destructive"
				)}
				style={{ width: `${Math.round(fraction * PERCENT)}%` }}
			/>
		</div>
	);
}

function UploadItemRow({
	item,
	onCancel,
	onRetry,
}: {
	item: UploadListItem;
	onCancel?: (id: string) => void;
	onRetry?: (id: string) => void;
}) {
	return (
		<motion.div
			animate={{ opacity: 1, y: 0 }}
			className="flex flex-col gap-2 rounded-lg bg-muted/40 p-3"
			exit={{ opacity: 0, scale: 0.98 }}
			initial={{ opacity: 0, y: 6 }}
			layout
		>
			<div className="flex items-center justify-between gap-3">
				<span className="flex min-w-0 items-center gap-2">
					<FileIcon
						aria-hidden="true"
						className="size-4 shrink-0 text-muted-foreground"
					/>
					<span className="min-w-0">
						<span className="block truncate text-sm">{item.name}</span>
						<span className="block text-muted-foreground text-xs">
							{item.status === "error"
								? (item.error ?? "Upload failed")
								: formatBytes(item.size)}
						</span>
					</span>
				</span>
				<UploadItemActions item={item} onCancel={onCancel} onRetry={onRetry} />
			</div>
			<UploadProgressBar item={item} />
		</motion.div>
	);
}

/** The in-flight/completed/failed uploads, newest last, with enter/exit
 * animation. Purely presentational — retry/cancel semantics come from the
 * consumer's upload protocol. */
export function UploadList({
	className,
	items,
	onCancel,
	onRetry,
}: {
	className?: string;
	items: UploadListItem[];
	onCancel?: (id: string) => void;
	onRetry?: (id: string) => void;
}) {
	if (items.length === 0) {
		return null;
	}
	return (
		<div className={cn("flex flex-col gap-2", className)}>
			<AnimatePresence initial={false}>
				{items.map((item) => (
					<UploadItemRow
						item={item}
						key={item.id}
						onCancel={onCancel}
						onRetry={onRetry}
					/>
				))}
			</AnimatePresence>
		</div>
	);
}
