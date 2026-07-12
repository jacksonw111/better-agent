"use client";

import { useIsMobile } from "@better-agent/ui/hooks/use-mobile";
import { type CSSProperties, useState } from "react";
import { Drawer } from "vaul";
import { PdfViewer } from "./pdf-viewer";

interface PdfDrawerProps {
	onOpenChange: (open: boolean) => void;
	open: boolean;
	pdfUrl: string | null;
	title?: string;
}

// Inline z-index/height — the tailwind-rules pre-commit hook forbids arbitrary
// class values like z-[61] / h-[92dvh].
const OVERLAY_STYLE: CSSProperties = { zIndex: 60 };
const MOBILE_CONTENT_STYLE: CSSProperties = { zIndex: 61, height: "92dvh" };
const DESKTOP_CONTENT_STYLE: CSSProperties = { zIndex: 61 };

// vaul owns mount/unmount + slide animation via `open`, so Content renders
// UNCONDITIONALLY — gating it on pdfUrl would unmount it before the close
// animation can play. `rendered` keeps the last url valid while sliding out.
function PdfDrawerInner({
	pdfUrl,
	title,
	onClose,
}: {
	onClose: () => void;
	pdfUrl: string | null;
	title?: string;
}) {
	if (pdfUrl === null) {
		return null;
	}
	return <PdfViewer onClose={onClose} pdfUrl={pdfUrl} title={title} />;
}

export function PdfDrawer({
	open,
	onOpenChange,
	pdfUrl,
	title,
}: PdfDrawerProps) {
	const isMobile = useIsMobile();
	const [rendered, setRendered] = useState<string | null>(pdfUrl);
	if (pdfUrl !== null && pdfUrl !== rendered) {
		setRendered(pdfUrl);
	}
	const handleClose = () => onOpenChange(false);

	return (
		<Drawer.Root
			direction={isMobile ? "bottom" : "right"}
			onOpenChange={onOpenChange}
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
							: "fixed inset-y-0 right-0 z-50 flex h-full w-full flex-col bg-background outline-none sm:max-w-3xl"
					}
					style={isMobile ? MOBILE_CONTENT_STYLE : DESKTOP_CONTENT_STYLE}
				>
					<Drawer.Title className="sr-only">{title ?? "文档"}</Drawer.Title>
					{isMobile ? (
						<div
							aria-hidden="true"
							className="mx-auto mt-2 h-1.5 w-12 shrink-0 rounded-full bg-muted"
						/>
					) : null}
					<PdfDrawerInner
						onClose={handleClose}
						pdfUrl={rendered}
						title={title}
					/>
				</Drawer.Content>
			</Drawer.Portal>
		</Drawer.Root>
	);
}
