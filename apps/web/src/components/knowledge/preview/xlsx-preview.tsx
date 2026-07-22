import { Button } from "@better-agent/ui/components/button";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import type { WorkBook } from "xlsx";
import type { KnowledgeDocument } from "../knowledge-types";
import { fetchDocumentBytes } from "./fetch-bytes";
import { DownloadFallback, PreviewSkeleton } from "./preview-chrome";
import { VirtualTable } from "./virtual-table";

// XLSX preview via SheetJS (pinned to the official CDN tarball — the npm
// 'xlsx' package is frozen with unpatched CVEs). Each sheet materialises at
// most MAX_ROWS×MAX_COLS as strings; rendering is row-virtualized.

const MAX_ROWS = 2000;
const MAX_COLS = 100;

interface ParsedSheet {
	rows: string[][];
	truncated: boolean;
}

async function parseWorkbook(bytes: ArrayBuffer): Promise<WorkBook> {
	const XLSX = await import("xlsx");
	return XLSX.read(bytes, { dense: true });
}

async function sheetRows(
	workbook: WorkBook,
	name: string
): Promise<ParsedSheet> {
	const XLSX = await import("xlsx");
	const sheet = workbook.Sheets[name];
	if (!sheet?.["!ref"]) {
		return { rows: [], truncated: false };
	}
	const full = XLSX.utils.decode_range(sheet["!ref"]);
	const clamped = {
		s: full.s,
		e: {
			r: Math.min(full.e.r, full.s.r + MAX_ROWS - 1),
			c: Math.min(full.e.c, full.s.c + MAX_COLS - 1),
		},
	};
	const rows = XLSX.utils.sheet_to_json<string[]>(sheet, {
		header: 1,
		raw: false,
		defval: "",
		range: XLSX.utils.encode_range(clamped),
	});
	return {
		rows: rows.map((row) => row.map((cell) => String(cell ?? ""))),
		truncated: full.e.r > clamped.e.r || full.e.c > clamped.e.c,
	};
}

function SheetTabs({
	active,
	names,
	onSelect,
}: {
	active: string;
	names: string[];
	onSelect: (name: string) => void;
}) {
	if (names.length <= 1) {
		return null;
	}
	return (
		<div className="flex gap-1 overflow-x-auto px-3 pt-2">
			{names.map((name) => (
				<Button
					key={name}
					onClick={() => onSelect(name)}
					size="xs"
					variant={name === active ? "secondary" : "ghost"}
				>
					{name}
				</Button>
			))}
		</div>
	);
}

function SheetBody({
	doc,
	sheet,
}: {
	doc: KnowledgeDocument;
	sheet: ParsedSheet;
}) {
	if (sheet.rows.length === 0) {
		return <DownloadFallback doc={doc} reason="This sheet is empty." />;
	}
	return (
		<VirtualTable
			note={
				sheet.truncated
					? `Showing the first ${MAX_ROWS.toLocaleString()} rows — download for the full sheet.`
					: undefined
			}
			rows={sheet.rows}
		/>
	);
}

export default function XlsxPreview({ doc }: { doc: KnowledgeDocument }) {
	const [selected, setSelected] = useState<string | null>(null);
	const workbook = useQuery({
		queryKey: ["knowledge-xlsx", doc.id],
		queryFn: async () => parseWorkbook(await fetchDocumentBytes(doc.id)),
		staleTime: Number.POSITIVE_INFINITY,
	});
	const sheetName = selected ?? workbook.data?.SheetNames[0] ?? "";
	const sheet = useQuery({
		queryKey: ["knowledge-xlsx-sheet", doc.id, sheetName],
		queryFn: () => sheetRows(workbook.data as WorkBook, sheetName),
		enabled: workbook.isSuccess && sheetName !== "",
		staleTime: Number.POSITIVE_INFINITY,
	});
	if (workbook.isError || sheet.isError) {
		return <DownloadFallback doc={doc} reason="The preview failed to load." />;
	}
	if (!(workbook.isSuccess && sheet.isSuccess)) {
		return <PreviewSkeleton />;
	}
	return (
		<div className="flex h-full flex-col">
			<SheetTabs
				active={sheetName}
				names={workbook.data.SheetNames}
				onSelect={setSelected}
			/>
			<div className="min-h-0 flex-1">
				<SheetBody doc={doc} sheet={sheet.data} />
			</div>
		</div>
	);
}
