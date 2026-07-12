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
		import("react-pdf")
			.then(({ Document, Page, pdfjs }) => {
				pdfjs.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;
				setMod({ Document, Page } as PdfModule);
			})
			.catch(() => setError(true));
	}, []);

	return { error, mod };
}
