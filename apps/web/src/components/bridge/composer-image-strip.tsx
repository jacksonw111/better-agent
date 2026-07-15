import { Button } from "@better-agent/ui/components/button";
import { ImageIcon, Loader2Icon, PaperclipIcon, XIcon } from "lucide-react";
import type {
	ClipboardEvent as ReactClipboardEvent,
	DragEvent as ReactDragEvent,
} from "react";
import { useRef } from "react";
import {
	type ImageAttachments,
	type PendingImage,
	type UploadImage,
	useImageAttachments,
} from "./use-image-attachments";

/** Never actually called: the placeholder upload behind a DISABLED attach
 * surface, so the composer's `useImageAttachments` call can stay an
 * unconditional hook. */
const UPLOAD_DISABLED: UploadImage = () =>
	Promise.reject(new Error("image upload unavailable"));

/** The composer's attach surface, or `undefined` when disabled — wraps the
 * unconditional `useImageAttachments` call (rules of hooks) so the whole
 * surface is gated on `imageUpload` being provided. */
export function useComposerImages(
	imageUpload: UploadImage | undefined
): ImageAttachments | undefined {
	const attachments = useImageAttachments(imageUpload ?? UPLOAD_DISABLED);
	return imageUpload ? attachments : undefined;
}

/** Paste/drop handlers for the composer's wrapper div — only mounted when the
 * attach surface is enabled. Paste events bubble up from the textarea. */
export function imageDropHandlers(images: ImageAttachments) {
	return {
		onDragOver: (event: ReactDragEvent) => {
			if (event.dataTransfer.types.includes("Files")) {
				event.preventDefault();
			}
		},
		onDrop: (event: ReactDragEvent) => {
			if (event.dataTransfer.files.length > 0) {
				event.preventDefault();
				images.addFiles(event.dataTransfer.files);
			}
		},
		onPaste: (event: ReactClipboardEvent) => {
			const files = [...event.clipboardData.files].filter((file) =>
				file.type.startsWith("image/")
			);
			if (files.length > 0) {
				event.preventDefault();
				images.addFiles(files);
			}
		},
	};
}

// P3-T2: the composer's pending-image thumbnails (above the box) plus the
// paperclip attach button (toolbar's left slot). Borderless language: tint +
// rounded, no border/ring.

function Thumb({
	image,
	onRemove,
}: {
	image: PendingImage;
	onRemove: (localId: string) => void;
}) {
	return (
		<div className="relative size-14 shrink-0 overflow-hidden rounded-lg bg-muted/60">
			{image.previewUrl ? (
				// biome-ignore lint/performance/noImgElement: object-URL previews can't go through next/image
				<img
					alt={image.name}
					className="size-full object-cover"
					height={56}
					src={image.previewUrl}
					width={56}
				/>
			) : (
				<div className="flex size-full items-center justify-center">
					<ImageIcon className="size-5 text-muted-foreground" />
				</div>
			)}
			{image.uploading && (
				<div className="absolute inset-0 flex items-center justify-center bg-background/60">
					<Loader2Icon className="size-4 animate-spin text-muted-foreground" />
				</div>
			)}
			<button
				aria-label={`移除图片 ${image.name}`}
				className="absolute top-0.5 right-0.5 rounded-full bg-background/80 p-0.5 text-muted-foreground transition-colors hover:text-foreground"
				onClick={() => onRemove(image.localId)}
				type="button"
			>
				<XIcon className="size-3" />
			</button>
		</div>
	);
}

/** The horizontal thumbnails row rendered above the prompt box while any
 * pending image exists. */
export function ComposerImageStrip({
	images,
}: {
	images: Pick<ImageAttachments, "pending" | "remove">;
}) {
	if (images.pending.length === 0) {
		return null;
	}
	return (
		<div className="mb-2 flex gap-2 overflow-x-auto rounded-xl bg-muted/40 p-2">
			{images.pending.map((image) => (
				<Thumb image={image} key={image.localId} onRemove={images.remove} />
			))}
		</div>
	);
}

/** The paperclip in the toolbar's left slot: opens a hidden multi-select
 * image file input feeding `addFiles`. */
export function AttachImageButton({
	addFiles,
	disabled,
}: {
	addFiles: ImageAttachments["addFiles"];
	disabled: boolean;
}) {
	const inputRef = useRef<HTMLInputElement>(null);
	return (
		<>
			<input
				accept="image/*"
				className="hidden"
				multiple
				onChange={(event) => {
					addFiles(event.target.files ?? []);
					event.target.value = "";
				}}
				ref={inputRef}
				type="file"
			/>
			<Button
				aria-label="附加图片"
				disabled={disabled}
				onClick={() => inputRef.current?.click()}
				size="icon-sm"
				type="button"
				variant="ghost"
			>
				<PaperclipIcon className="size-4" />
			</Button>
		</>
	);
}
