import { useRef, useState } from "react";
import { toast } from "sonner";

// P3-T2: the composer's pending-image state. Files are uploaded IMMEDIATELY
// on attach (paperclip/paste/drop) against the bridge session, so a send only
// ever carries lightweight id refs — the CLI downloads the bytes back down at
// dispatch time (apps/bridge-cli/src/image-input.ts). Mounted only when the
// session's `images` capability AND the transport's `uploadAttachment` are
// both present (see terminal.tsx).

/** One image reference riding a text command — the web twin of the CLI's
 * `ImageRef` (apps/bridge-cli/src/commands-text-when.ts). */
export interface ImageRef {
	id: string;
	mime: string;
	name: string;
}

/** Suffix the optimistic local echo appends when images ride a send —
 * BYTE-IDENTICAL to the CLI's own `imageCountSuffix`
 * (apps/bridge-cli/src/image-input.ts; keep the two in sync) so the echoed
 * line and the CLI-persisted user message dedupe cleanly. */
export function imageCountSuffix(count: number): string {
	return count > 0 ? ` [图片×${count}]` : "";
}

export interface PendingImage {
	/** Local identity for list keys/removal — NOT the server attachment id. */
	localId: string;
	name: string;
	/** Object URL for the thumbnail; absent where createObjectURL is
	 * unavailable (jsdom). Revoked on remove/take. */
	previewUrl?: string;
	/** The uploaded ref once the round trip lands; absent while uploading. */
	ref?: ImageRef;
	uploading: boolean;
}

export interface ImageAttachments {
	addFiles: (files: Iterable<File>) => void;
	pending: PendingImage[];
	remove: (localId: string) => void;
	/** The uploaded refs, consumed for one send: clears the strip and revokes
	 * every preview URL. Call only when `uploading` is false. */
	takeRefs: () => ImageRef[];
	/** True while any attach's upload round trip is still in flight. */
	uploading: boolean;
}

export type UploadImage = (file: File) => Promise<ImageRef>;

const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;

function previewUrlFor(file: File): string | undefined {
	try {
		return URL.createObjectURL(file);
	} catch {
		// jsdom has no createObjectURL — thumbnails degrade to name-only chips.
		// biome-ignore lint/complexity/noUselessUndefined: explicit so every path returns a value (eslint consistent-return)
		return undefined;
	}
}

function revokePreview(image: PendingImage): void {
	if (image.previewUrl) {
		URL.revokeObjectURL(image.previewUrl);
	}
}

let nextLocalId = 0;

/** Client-side pre-checks mirroring the server's `validateImageUpload` so an
 * obviously-bad file fails fast with a toast instead of a round trip. The
 * server remains the authority (magic-byte sniff etc.). */
function acceptable(file: File): boolean {
	if (!file.type.startsWith("image/")) {
		toast.error(`不支持的文件类型: ${file.name}`);
		return false;
	}
	if (file.size > MAX_UPLOAD_BYTES) {
		toast.error(`图片超过 8MB 上限: ${file.name}`);
		return false;
	}
	return true;
}

/** The strip's mutable state handle: a ref (so async settles never act on a
 * stale snapshot) plus the setState that re-renders the strip. */
interface StripState {
	pendingRef: { current: PendingImage[] };
	set: (next: PendingImage[]) => void;
}

/** Marks one entry uploaded (`ref`) or drops it (`null`, failed upload). */
function settle(state: StripState, localId: string, ref: ImageRef | null) {
	const current = state.pendingRef.current;
	const next = ref
		? current.map((image) =>
				image.localId === localId ? { ...image, ref, uploading: false } : image
			)
		: dropOne(current, localId);
	state.set(next);
}

function dropOne(current: PendingImage[], localId: string): PendingImage[] {
	return current.filter((image) => {
		if (image.localId === localId) {
			revokePreview(image);
			return false;
		}
		return true;
	});
}

/** Uploads each accepted file immediately; a failure toasts + drops its entry. */
function addFilesTo(
	state: StripState,
	upload: UploadImage,
	files: Iterable<File>
) {
	for (const file of files) {
		if (!acceptable(file)) {
			continue;
		}
		nextLocalId += 1;
		const localId = `img-${nextLocalId}`;
		state.set([
			...state.pendingRef.current,
			{
				localId,
				name: file.name,
				previewUrl: previewUrlFor(file),
				uploading: true,
			},
		]);
		upload(file)
			.then((ref) => settle(state, localId, ref))
			.catch((error: unknown) => {
				toast.error(
					error instanceof Error ? error.message : `图片上传失败: ${file.name}`
				);
				settle(state, localId, null);
			});
	}
}

/** Consumes the uploaded refs for one send: clears the strip + revokes previews. */
function takeRefsFrom(state: StripState): ImageRef[] {
	const refs: ImageRef[] = [];
	for (const image of state.pendingRef.current) {
		if (image.ref) {
			refs.push(image.ref);
		}
		revokePreview(image);
	}
	state.set([]);
	return refs;
}

/**
 * Owns the composer's image strip: `addFiles` uploads each accepted file
 * immediately (failures toast + drop that entry), `remove` discards one, and
 * `takeRefs` hands the uploaded refs to a send while clearing the strip.
 */
export function useImageAttachments(upload: UploadImage): ImageAttachments {
	const [pending, setPending] = useState<PendingImage[]>([]);
	const pendingRef = useRef<PendingImage[]>(pending);
	const state: StripState = {
		pendingRef,
		set: (next) => {
			pendingRef.current = next;
			setPending(next);
		},
	};

	return {
		addFiles: (files) => addFilesTo(state, upload, files),
		pending,
		remove: (localId) => state.set(dropOne(pendingRef.current, localId)),
		takeRefs: () => takeRefsFrom(state),
		uploading: pending.some((image) => image.uploading),
	};
}
