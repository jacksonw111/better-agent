import { type ComponentType, lazy } from "react";
import type { KnowledgeDocument } from "../knowledge-types";
import { CODE_EXTENSIONS } from "./code-langs";

// The pluggable preview registry (docs/research/2026-07-22-frontend-file-
// preview.md): ordered providers matched on mime OR extension — the stored
// mime is client-declared at upload time, so the filename extension is an
// equal citizen. Every viewer is its own lazy chunk; per-format byte caps
// keep slow parses from ever starting (too big → download fallback).
// PDFs don't pass through here — the drawer renders PdfViewerSrc directly.

const MB = 1024 * 1024;

export interface PreviewProvider {
	Component: ComponentType<{ doc: KnowledgeDocument }>;
	id: string;
	match: (mime: string, ext: string) => boolean;
	maxBytes: number;
}

export function fileExtension(name: string): string {
	const dot = name.lastIndexOf(".");
	return dot < 0 ? "" : name.slice(dot + 1).toLowerCase();
}

const TEXT_MIMES = new Set(["application/json", "application/xml"]);

export const PREVIEW_PROVIDERS: PreviewProvider[] = [
	{
		id: "image",
		maxBytes: Number.POSITIVE_INFINITY, // streams via <img>, never materialised
		match: (mime) => mime.startsWith("image/"),
		Component: lazy(() => import("./image-preview")),
	},
	{
		id: "csv",
		maxBytes: 200 * MB, // worker-streamed with a row cap; size is irrelevant
		match: (mime, ext) => mime === "text/csv" || ext === "csv" || ext === "tsv",
		Component: lazy(() => import("./csv-preview")),
	},
	{
		id: "xlsx",
		maxBytes: 10 * MB, // SheetJS parses on the main thread — keep it snappy
		match: (mime, ext) =>
			ext === "xlsx" ||
			mime ===
				"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
		Component: lazy(() => import("./xlsx-preview")),
	},
	{
		id: "docx",
		maxBytes: 10 * MB,
		match: (mime, ext) =>
			ext === "docx" ||
			mime ===
				"application/vnd.openxmlformats-officedocument.wordprocessingml.document",
		Component: lazy(() => import("./docx-preview-viewer")),
	},
	{
		id: "epub",
		maxBytes: 50 * MB,
		match: (mime, ext) => ext === "epub" || mime === "application/epub+zip",
		Component: lazy(() => import("./epub-preview")),
	},
	{
		id: "code",
		maxBytes: 5 * MB, // >512KB skips highlighting internally, plain text to 5MB
		match: (mime, ext) =>
			mime.startsWith("text/") ||
			TEXT_MIMES.has(mime) ||
			CODE_EXTENSIONS.has(ext),
		Component: lazy(() => import("./code-preview")),
	},
];

/** First provider claiming the document, or null → download fallback. */
export function resolvePreview(doc: {
	mime: string;
	name: string;
}): PreviewProvider | null {
	const ext = fileExtension(doc.name);
	return (
		PREVIEW_PROVIDERS.find((provider) => provider.match(doc.mime, ext)) ?? null
	);
}
