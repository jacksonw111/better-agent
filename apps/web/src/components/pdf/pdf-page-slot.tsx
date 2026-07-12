"use client";

import { type RefObject, useRef } from "react";
import { useNearViewport } from "./use-near-viewport";
import type { PdfModule } from "./use-pdf-module";

// Approximate A4 aspect ratio for the not-yet-rendered placeholder height so
// the scrollbar stays sensible before a page rasterizes. A4 210x297mm → √2.
const A4_RATIO = Math.SQRT2;

interface PdfPageSlotProps {
	containerWidth: number;
	mod: PdfModule;
	pageNumber: number;
	scale: number;
	scrollRoot: RefObject<HTMLElement | null>;
}

export function PdfPageSlot({
	containerWidth,
	mod,
	pageNumber,
	scale,
	scrollRoot,
}: PdfPageSlotProps) {
	const slotRef = useRef<HTMLDivElement>(null);
	const near = useNearViewport(slotRef, scrollRoot);
	const { Page } = mod;

	const placeholderHeight = Math.round(containerWidth * A4_RATIO * scale);

	return (
		<div ref={slotRef}>
			{near ? (
				<Page pageNumber={pageNumber} scale={scale} width={containerWidth} />
			) : (
				<div style={{ height: placeholderHeight, width: containerWidth }} />
			)}
		</div>
	);
}
