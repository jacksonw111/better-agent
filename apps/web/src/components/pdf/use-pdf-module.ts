"use client";

import { useEffect, useState } from "react";

// react-pdf (and its pdfjs worker) is a heavy client-only bundle, so it's
// dynamically imported the first time a PDF is actually opened rather than
// shipped with the app shell.

interface PdfDocument {
	numPages: number;
}

export interface PdfDocumentProps {
	children?: React.ReactNode;
	file: string;
	loading?: React.ReactNode;
	onLoadError?: () => void;
	onLoadSuccess?: (doc: PdfDocument) => void;
	options?: Record<string, unknown>;
}

export interface PdfPageProps {
	pageNumber: number;
	scale?: number;
	width?: number;
}

export interface PdfModule {
	Document: React.ComponentType<PdfDocumentProps>;
	Page: React.ComponentType<PdfPageProps>;
}

export interface PdfModuleState {
	error: boolean;
	mod: PdfModule | null;
}

export function usePdfModule(): PdfModuleState {
	const [mod, setMod] = useState<PdfModule | null>(null);
	const [error, setError] = useState(false);

	useEffect(() => {
		// Self-hosted worker: the ?url import makes Vite emit pdfjs-dist's worker
		// as an asset of our own bundle, so opening a PDF never depends on unpkg
		// being up (and never pays a cold third-party CDN round trip). pdfjs-dist
		// is pinned in package.json to react-pdf's own version.
		Promise.all([
			import("react-pdf"),
			import("pdfjs-dist/build/pdf.worker.min.mjs?url"),
		])
			.then(([{ Document, Page, pdfjs }, worker]) => {
				pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
				setMod({ Document, Page } as PdfModule);
			})
			.catch(() => setError(true));
	}, []);

	return { error, mod };
}
