"use client";

import { type RefObject, useEffect, useRef, useState } from "react";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";
import { PdfHeaderBar } from "./pdf-header-bar";
import { PdfPageSlot } from "./pdf-page-slot";
import { proxyPdfUrl } from "./proxy-pdf-url";
import type { PdfModule } from "./use-pdf-module";
import { usePdfModule } from "./use-pdf-module";
import { useZoom } from "./use-zoom";

// Stable identity — react-pdf re-fetches the whole document whenever `options`
// changes identity, so an inline literal would refetch on every resize/zoom.
const PDF_OPTIONS = {};

function PdfSpinner() {
	return (
		<div
			aria-label="加载中"
			className="flex items-center justify-center py-16"
			role="status"
		>
			<span className="size-8 animate-spin rounded-full border-2 border-muted border-t-foreground" />
		</div>
	);
}

interface PdfPagesProps {
	containerRef: RefObject<HTMLDivElement | null>;
	containerWidth: number;
	mod: PdfModule;
	numPages: number;
	onLoadError: () => void;
	onLoadSuccess: (doc: { numPages: number }) => void;
	scale: number;
	src: string;
}

function PdfPages({
	mod,
	src,
	scale,
	containerRef,
	containerWidth,
	numPages,
	onLoadSuccess,
	onLoadError,
}: PdfPagesProps) {
	const { Document } = mod;
	return (
		<Document
			file={src}
			loading={<PdfSpinner />}
			onLoadError={onLoadError}
			onLoadSuccess={onLoadSuccess}
			options={PDF_OPTIONS}
		>
			{Array.from({ length: numPages }, (_, i) => {
				const pageNumber = i + 1;
				return (
					<PdfPageSlot
						containerWidth={containerWidth}
						key={pageNumber}
						mod={mod}
						pageNumber={pageNumber}
						scale={scale}
						scrollRoot={containerRef}
					/>
				);
			})}
		</Document>
	);
}

function useContainerWidth(containerRef: RefObject<HTMLDivElement | null>) {
	const [containerWidth, setContainerWidth] = useState(0);
	useEffect(() => {
		const el = containerRef.current;
		// Round + skip no-op updates so sub-pixel resize jitter doesn't re-render
		// (and re-rasterize) every page on each ResizeObserver tick.
		const apply = (w: number) => {
			const next = Math.round(w);
			if (next > 0) {
				setContainerWidth((prev) => (prev === next ? prev : next));
			}
		};
		const ro = new ResizeObserver((entries) => {
			const w = entries[0]?.contentRect.width;
			if (w) {
				apply(w);
			}
		});
		if (el) {
			apply(el.getBoundingClientRect().width);
			ro.observe(el);
		}
		return () => ro.disconnect();
	}, [containerRef]);
	return containerWidth;
}

function PdfErrorState({ src }: { src: string | null }) {
	return (
		<div className="p-4 text-center text-sm">
			{src ? (
				<a
					className="text-primary hover:underline"
					href={src}
					rel="noopener noreferrer"
					target="_blank"
				>
					无法加载该 PDF，点此在新标签打开
				</a>
			) : (
				<span className="text-muted-foreground">该文档暂时无法打开</span>
			)}
		</div>
	);
}

interface PdfReadyViewProps {
	containerRef: RefObject<HTMLDivElement | null>;
	containerWidth: number;
	mod: PdfModule | null;
	numPages: number;
	onLoadError: () => void;
	onLoadSuccess: (doc: { numPages: number }) => void;
	scale: number;
	src: string;
}

// The scroll container (which carries containerRef) must mount immediately and
// stay mounted, otherwise useContainerWidth never measures it, containerWidth
// stays 0, and the pages never render. So always render the container; swap the
// spinner for the pages once the module + width are ready.
function PdfReadyView({
	containerRef,
	containerWidth,
	mod,
	numPages,
	onLoadError,
	onLoadSuccess,
	scale,
	src,
}: PdfReadyViewProps) {
	return (
		<div className="flex-1 overflow-auto" ref={containerRef}>
			{mod && containerWidth > 0 ? (
				<PdfPages
					containerRef={containerRef}
					containerWidth={containerWidth}
					mod={mod}
					numPages={numPages}
					onLoadError={onLoadError}
					onLoadSuccess={onLoadSuccess}
					scale={scale}
					src={src}
				/>
			) : (
				<PdfSpinner />
			)}
		</div>
	);
}

function usePdfViewerState() {
	const [mounted, setMounted] = useState(false);
	const [numPages, setNumPages] = useState(0);
	const [docError, setDocError] = useState(false);
	const containerRef = useRef<HTMLDivElement>(null);
	const containerWidth = useContainerWidth(containerRef);
	useEffect(() => {
		setMounted(true);
	}, []);
	return {
		mounted,
		numPages,
		setNumPages,
		docError,
		setDocError,
		containerRef,
		containerWidth,
	};
}

interface PdfViewerSrcProps {
	onClose: () => void;
	/** A directly-fetchable PDF URL (already proxied/authed); null = failed. */
	src: string | null;
	title?: string;
}

/** The viewer over a resolved URL — for sources our own server can stream
 * (e.g. Knowledge Base documents) that must NOT go through the public
 * pdf-proxy. Finance callers use PdfViewer below, which proxies first. */
export function PdfViewerSrc({ src, onClose, title }: PdfViewerSrcProps) {
	const zoom = useZoom();
	const { error: moduleError, mod } = usePdfModule();
	const state = usePdfViewerState();
	const {
		numPages,
		setNumPages,
		docError,
		setDocError,
		containerRef,
		containerWidth,
		mounted,
	} = state;
	const activeMod = moduleError || docError || !mounted ? null : mod;
	const failed = moduleError || docError || src === null;
	return (
		<>
			<PdfHeaderBar
				onClose={onClose}
				onReset={zoom.reset}
				onZoomIn={zoom.zoomIn}
				onZoomOut={zoom.zoomOut}
				pageCount={numPages}
				scale={zoom.scale}
				title={title}
			/>
			{failed || src === null ? (
				<PdfErrorState src={src} />
			) : (
				<PdfReadyView
					containerRef={containerRef}
					containerWidth={containerWidth}
					mod={activeMod}
					numPages={numPages}
					onLoadError={() => setDocError(true)}
					onLoadSuccess={(doc) => setNumPages(doc.numPages)}
					scale={zoom.scale}
					src={src}
				/>
			)}
		</>
	);
}

interface PdfViewerProps {
	onClose: () => void;
	pdfUrl: string;
	title?: string;
}

export function PdfViewer({ pdfUrl, onClose, title }: PdfViewerProps) {
	return (
		<PdfViewerSrc onClose={onClose} src={proxyPdfUrl(pdfUrl)} title={title} />
	);
}
