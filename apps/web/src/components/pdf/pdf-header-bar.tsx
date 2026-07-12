import { Button } from "@better-agent/ui/components/button";
import { XIcon } from "lucide-react";

const MIN_SCALE = 0.4;
const MAX_SCALE = 3;
const SCALE_PCT = 100;

interface PdfZoomControlsProps {
	onReset: () => void;
	onZoomIn: () => void;
	onZoomOut: () => void;
	scale: number;
}

function PdfZoomControls({
	scale,
	onZoomIn,
	onZoomOut,
	onReset,
}: PdfZoomControlsProps) {
	return (
		<div className="flex items-center gap-1">
			<Button
				aria-label="缩小"
				className="min-h-10 min-w-10"
				disabled={scale <= MIN_SCALE}
				onClick={onZoomOut}
				size="sm"
				variant="outline"
			>
				−
			</Button>
			<button
				aria-label="重置缩放"
				className="min-h-10 min-w-16 rounded px-2 py-1 text-sm hover:bg-muted"
				onClick={onReset}
				type="button"
			>
				{Math.round(scale * SCALE_PCT)}%
			</button>
			<Button
				aria-label="放大"
				className="min-h-10 min-w-10"
				disabled={scale >= MAX_SCALE}
				onClick={onZoomIn}
				size="sm"
				variant="outline"
			>
				＋
			</Button>
		</div>
	);
}

interface PdfHeaderBarProps {
	onClose: () => void;
	onReset: () => void;
	onZoomIn: () => void;
	onZoomOut: () => void;
	pageCount: number;
	scale: number;
	title?: string;
}

export function PdfHeaderBar({
	scale,
	onClose,
	onZoomIn,
	onZoomOut,
	onReset,
	pageCount,
	title,
}: PdfHeaderBarProps) {
	return (
		<div className="sticky top-0 z-10 flex items-center gap-2 border-b bg-background/95 px-2 py-1 backdrop-blur-sm">
			<Button
				aria-label="关闭"
				className="min-h-11 min-w-11"
				onClick={onClose}
				size="icon"
				variant="ghost"
			>
				<XIcon className="size-5" />
			</Button>
			<PdfZoomControls
				onReset={onReset}
				onZoomIn={onZoomIn}
				onZoomOut={onZoomOut}
				scale={scale}
			/>
			{title ? (
				<span className="ml-1 min-w-0 flex-1 truncate text-sm" title={title}>
					{title}
				</span>
			) : null}
			{pageCount > 0 ? (
				<span className="ml-auto shrink-0 text-muted-foreground text-xs">
					共 {pageCount} 页
				</span>
			) : null}
		</div>
	);
}
