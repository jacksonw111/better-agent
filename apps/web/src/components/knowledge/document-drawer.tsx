import { Button } from "@better-agent/ui/components/button";
import { useIsMobile } from "@better-agent/ui/hooks/use-mobile";
import { formatBytes } from "@better-agent/ui/lib/format-bytes";
import { DownloadIcon, XIcon } from "lucide-react";
import { type CSSProperties, useMemo, useState } from "react";
import { Drawer } from "vaul";
import { PdfViewerSrc } from "@/components/pdf/pdf-viewer";
import { documentContentUrl } from "./content-url";
import { DocumentPreview } from "./document-preview";
import {
	documentDateTimeFormatter,
	type KnowledgeDocument,
} from "./knowledge-types";

// Inline z-index/height — the tailwind-rules pre-commit hook forbids arbitrary
// class values like z-[61] / h-[92dvh] (same as pdf-drawer.tsx).
const OVERLAY_STYLE: CSSProperties = { zIndex: 60 };
const MOBILE_CONTENT_STYLE: CSSProperties = { zIndex: 61, height: "92dvh" };
const DESKTOP_CONTENT_STYLE: CSSProperties = { zIndex: 61 };

function DrawerHeader({
	doc,
	onClose,
}: {
	doc: KnowledgeDocument | null;
	onClose: () => void;
}) {
	return (
		<header className="flex items-center justify-between gap-3 p-4">
			<div className="min-w-0">
				<p className="truncate font-medium text-sm">
					{doc?.name ?? "Document"}
				</p>
				{doc ? (
					<p className="text-muted-foreground text-xs">
						{formatBytes(doc.size)} ·{" "}
						{documentDateTimeFormatter.format(new Date(doc.createdAt))}
					</p>
				) : null}
			</div>
			<div className="flex shrink-0 items-center gap-1">
				{doc ? (
					<Button
						render={
							// biome-ignore lint/a11y/useAnchorContent: Button injects the children into the anchor
							<a href={documentContentUrl(doc.id, { download: true })} />
						}
						size="icon-xs"
						variant="ghost"
					>
						<DownloadIcon className="size-4" />
					</Button>
				) : null}
				<Button
					aria-label="Close"
					onClick={onClose}
					size="icon-xs"
					variant="ghost"
				>
					<XIcon className="size-4" />
				</Button>
			</div>
		</header>
	);
}

function DrawerBody({
	doc,
	onClose,
}: {
	doc: KnowledgeDocument;
	onClose: () => void;
}) {
	// Stable per-document identity: react-pdf refetches whenever `file` changes,
	// so the URL must not be rebuilt on every render.
	const src = useMemo(() => documentContentUrl(doc.id), [doc.id]);
	if (doc.mime === "application/pdf") {
		// The full annual-report viewer: streamed loading, zoom, page count —
		// it brings its own header (title + close), so no DrawerHeader here.
		return <PdfViewerSrc onClose={onClose} src={src} title={doc.name} />;
	}
	return (
		<>
			<DrawerHeader doc={doc} onClose={onClose} />
			<div className="min-h-0 flex-1 overflow-auto">
				<DocumentPreview doc={doc} />
			</div>
		</>
	);
}

/**
 * The document viewer drawer. `dismissible={false}` is deliberate product
 * behavior: overlay clicks, Esc and drag do NOT close it — only the close
 * icon does. `rendered` keeps the last document mounted while the drawer
 * slides out (same pattern as pdf-drawer.tsx).
 */
export function DocumentDrawer({
	doc,
	onClose,
	open,
}: {
	doc: KnowledgeDocument | null;
	onClose: () => void;
	open: boolean;
}) {
	const isMobile = useIsMobile();
	const [rendered, setRendered] = useState<KnowledgeDocument | null>(doc);
	if (doc !== null && doc !== rendered) {
		setRendered(doc);
	}

	return (
		<Drawer.Root
			direction={isMobile ? "bottom" : "right"}
			dismissible={false}
			open={open}
		>
			<Drawer.Portal>
				<Drawer.Overlay
					className="fixed inset-0 z-50 bg-black/50"
					style={OVERLAY_STYLE}
				/>
				<Drawer.Content
					className={
						isMobile
							? "fixed inset-x-0 bottom-0 z-50 flex flex-col rounded-t-xl bg-background outline-none"
							: "fixed inset-y-0 right-0 z-50 flex h-full w-full flex-col bg-background outline-none sm:max-w-2xl"
					}
					style={isMobile ? MOBILE_CONTENT_STYLE : DESKTOP_CONTENT_STYLE}
				>
					<Drawer.Title className="sr-only">
						{rendered?.name ?? "Document"}
					</Drawer.Title>
					{rendered ? <DrawerBody doc={rendered} onClose={onClose} /> : null}
				</Drawer.Content>
			</Drawer.Portal>
		</Drawer.Root>
	);
}
