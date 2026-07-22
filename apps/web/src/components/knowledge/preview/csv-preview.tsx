import { useEffect, useState } from "react";
import { documentContentUrl } from "../content-url";
import type { KnowledgeDocument } from "../knowledge-types";
import { DownloadFallback, PreviewSkeleton } from "./preview-chrome";
import { VirtualTable } from "./virtual-table";

// CSV preview: papaparse streams the file chunk-by-chunk inside a Web Worker
// (main thread never blocks), we keep the first MAX_ROWS and abort the parse
// — a 200MB CSV costs the same as a 2MB one. Rendering is row-virtualized.

const MAX_ROWS = 5000;

interface CsvState {
	error: boolean;
	rows: string[][] | null;
	truncated: boolean;
}

function useCsvRows(doc: KnowledgeDocument): CsvState {
	const [state, setState] = useState<CsvState>({
		error: false,
		rows: null,
		truncated: false,
	});
	useEffect(() => {
		let active = true;
		const rows: string[][] = [];
		let truncated = false;
		import("papaparse")
			.then(({ default: Papa }) => {
				Papa.parse<string[]>(documentContentUrl(doc.id), {
					download: true,
					worker: true,
					skipEmptyLines: true,
					chunk: (results, parser) => {
						rows.push(...results.data);
						if (rows.length >= MAX_ROWS) {
							truncated = true;
							parser.abort();
						}
					},
					complete: () => {
						if (active) {
							setState({
								error: false,
								rows: rows.slice(0, MAX_ROWS),
								truncated,
							});
						}
					},
					error: () => {
						if (active) {
							setState({ error: true, rows: null, truncated: false });
						}
					},
				});
			})
			.catch(() => {
				if (active) {
					setState({ error: true, rows: null, truncated: false });
				}
			});
		return () => {
			active = false;
		};
	}, [doc.id]);
	return state;
}

export default function CsvPreview({ doc }: { doc: KnowledgeDocument }) {
	const { error, rows, truncated } = useCsvRows(doc);
	if (error) {
		return <DownloadFallback doc={doc} reason="The preview failed to load." />;
	}
	if (rows === null) {
		return <PreviewSkeleton />;
	}
	if (rows.length === 0) {
		return <DownloadFallback doc={doc} reason="This file has no rows." />;
	}
	return (
		<VirtualTable
			note={
				truncated
					? `Showing the first ${MAX_ROWS.toLocaleString()} rows — download for the full file.`
					: undefined
			}
			rows={rows}
		/>
	);
}
