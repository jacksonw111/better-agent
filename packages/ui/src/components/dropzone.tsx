"use client";

import { cn } from "@better-agent/ui/lib/utils";
import { UploadCloudIcon } from "lucide-react";
import { type DragEvent, type RefObject, useRef, useState } from "react";

// Generic drag-and-drop file picker — pairs with upload.tsx's UploadList.
// Protocol-agnostic: it only surfaces File[]s.

function DropzoneInput({
	accept,
	inputRef,
	multiple,
	onFiles,
}: {
	accept?: string;
	inputRef: RefObject<HTMLInputElement | null>;
	multiple: boolean;
	onFiles: (files: File[]) => void;
}) {
	return (
		<input
			accept={accept}
			aria-label="Choose files"
			className="hidden"
			multiple={multiple}
			onChange={(event) => {
				const files = [...(event.target.files ?? [])];
				if (files.length > 0) {
					onFiles(files);
				}
				event.target.value = "";
			}}
			ref={inputRef}
			type="file"
		/>
	);
}

function useDragDepth(disabled: boolean, onFiles: (files: File[]) => void) {
	// Counter (not boolean): child elements fire their own enter/leave pairs.
	const [depth, setDepth] = useState(0);
	const guard = (event: DragEvent) => {
		event.preventDefault();
		event.stopPropagation();
	};
	return {
		active: depth > 0 && !disabled,
		onDragEnter: (event: DragEvent) => {
			guard(event);
			setDepth((d) => d + 1);
		},
		onDragLeave: (event: DragEvent) => {
			guard(event);
			setDepth((d) => Math.max(0, d - 1));
		},
		onDragOver: guard,
		onDrop: (event: DragEvent) => {
			guard(event);
			setDepth(0);
			if (!disabled) {
				const files = [...event.dataTransfer.files];
				if (files.length > 0) {
					onFiles(files);
				}
			}
		},
	};
}

function DropzoneCopy({ active, hint }: { active: boolean; hint?: string }) {
	return (
		<>
			<span
				className={cn(
					"flex size-11 items-center justify-center rounded-full bg-muted text-muted-foreground transition-all duration-200 group-hover:bg-primary/10 group-hover:text-primary",
					active && "-translate-y-0.5 bg-primary/15 text-primary"
				)}
			>
				<UploadCloudIcon aria-hidden="true" className="size-5" />
			</span>
			<span className="font-medium text-sm">
				{active
					? "Drop to upload"
					: "Drag & drop files here, or click to browse"}
			</span>
			{hint ? (
				<span className="text-muted-foreground text-xs">{hint}</span>
			) : null}
		</>
	);
}

export function Dropzone({
	accept,
	className,
	disabled = false,
	hint,
	multiple = true,
	onFiles,
}: {
	accept?: string;
	className?: string;
	disabled?: boolean;
	/** Small line under the main copy, e.g. size/type limits. */
	hint?: string;
	multiple?: boolean;
	onFiles: (files: File[]) => void;
}) {
	const inputRef = useRef<HTMLInputElement>(null);
	const drag = useDragDepth(disabled, onFiles);
	return (
		<>
			<DropzoneInput
				accept={accept}
				inputRef={inputRef}
				multiple={multiple}
				onFiles={onFiles}
			/>
			<button
				className={cn(
					"group flex w-full flex-col items-center justify-center gap-2 rounded-xl border-2 border-border border-dashed bg-muted/30 px-6 py-10 text-center outline-none transition-all duration-200",
					"hover:border-primary/40 hover:bg-primary/5 focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40",
					drag.active && "border-primary bg-primary/10 shadow-sm",
					disabled && "pointer-events-none opacity-50",
					className
				)}
				disabled={disabled}
				onClick={() => inputRef.current?.click()}
				onDragEnter={drag.onDragEnter}
				onDragLeave={drag.onDragLeave}
				onDragOver={drag.onDragOver}
				onDrop={drag.onDrop}
				type="button"
			>
				<DropzoneCopy active={drag.active} hint={hint} />
			</button>
		</>
	);
}
