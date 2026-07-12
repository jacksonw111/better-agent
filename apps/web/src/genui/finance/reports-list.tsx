import { Badge } from "@better-agent/ui/components/badge";
import { PdfLink } from "@/components/pdf/pdf-link";
import { MAX_RENDERED_ITEMS } from "../tool-renderers";
import type { ReportData } from "./finance-schemas-fe8";
import { formatDate } from "./format";
import { CardShell } from "./primitives";

const REPORT_TYPE_LABEL: Record<string, string> = {
	annual: "年报",
	h1: "中报",
	q1: "一季报",
	q3: "三季报",
};

function ReportTypeBadge({ reportType }: { reportType: string }) {
	const label = REPORT_TYPE_LABEL[reportType] ?? (reportType || "—");
	return <Badge variant="outline">{label}</Badge>;
}

function ReportRow({ item }: { item: ReportData }) {
	return (
		<div className="flex flex-col gap-1 border-b pb-2 last:border-b-0 last:pb-0">
			<div className="flex items-start justify-between gap-2">
				<span
					className="min-w-0 flex-1 truncate font-medium text-sm"
					title={item.title}
				>
					{item.title || "—"}
				</span>
				<ReportTypeBadge reportType={item.reportType} />
			</div>
			<div className="flex items-center gap-2 text-muted-foreground text-xs">
				<span>{formatDate(item.noticeDate)}</span>
				{item.pdfUrl ? (
					<PdfLink label="PDF" pdfUrl={item.pdfUrl} title={item.title} />
				) : null}
			</div>
		</div>
	);
}

/** finance_list_reports → 定期报告 (annual / H1 / Q1 / Q3), newest
 * `noticeDate` first (the tool already returns rows in that order), capped
 * at MAX_RENDERED_ITEMS. */
export function ReportsList({ data }: { data: ReportData[] }) {
	if (data.length === 0) {
		return null;
	}
	const visible = data.slice(0, MAX_RENDERED_ITEMS);
	const hiddenCount = data.length - visible.length;
	return (
		<CardShell title="定期报告">
			<div className="flex flex-col gap-2">
				{visible.map((item) => (
					<ReportRow item={item} key={item.artCode} />
				))}
			</div>
			{hiddenCount > 0 ? (
				<p className="text-muted-foreground text-xs">+{hiddenCount} more</p>
			) : null}
		</CardShell>
	);
}
