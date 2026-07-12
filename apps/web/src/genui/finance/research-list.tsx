import { PdfLink } from "@/components/pdf/pdf-link";
import { MAX_RENDERED_ITEMS } from "../tool-renderers";
import type { ResearchReportData } from "./finance-schemas-fe8";
import { formatDate, formatNum } from "./format";
import { CardShell } from "./primitives";

function EpsPeCell({
	label,
	eps,
	pe,
}: {
	label: string;
	eps: number | null;
	pe: number | null;
}) {
	return (
		<div className="flex flex-col items-center gap-0.5 rounded-md bg-muted/30 px-2 py-1">
			<span className="text-muted-foreground text-xs">{label}</span>
			<span className="text-xs tabular-nums">
				EPS {formatNum(eps)} · PE {formatNum(pe)}
			</span>
		</div>
	);
}

/** `org` + `date` is the natural identity for a research report, but two
 * reports from the same org on the same day (rare, but not impossible) would
 * collide — folding in the array index keeps every card key unique without
 * ever using the index alone. */
function researchKey(item: ResearchReportData, index: number): string {
	return `${item.org}-${item.date}-${index}`;
}

function ResearchCard({ item }: { item: ResearchReportData }) {
	return (
		<div className="flex flex-col gap-2 border-b pb-3 last:border-b-0 last:pb-0">
			<div className="flex flex-col gap-0.5">
				<span className="font-medium text-sm">{item.title || "—"}</span>
				<span className="text-muted-foreground text-xs">
					{item.org || "—"} · {formatDate(item.date)}
				</span>
			</div>
			<div className="grid grid-cols-3 gap-2">
				<EpsPeCell eps={item.epsY0} label="今年" pe={item.peY0} />
				<EpsPeCell eps={item.epsY1} label="明年" pe={item.peY1} />
				<EpsPeCell eps={item.epsY2} label="后年" pe={item.peY2} />
			</div>
			{item.pdfUrl ? (
				<PdfLink label="研报PDF" pdfUrl={item.pdfUrl} title={item.title} />
			) : null}
		</div>
	);
}

/** finance_research → 分析师研报, capped at MAX_RENDERED_ITEMS — this renders
 * inline in chat, not a full research archive. */
export function ResearchList({ data }: { data: ResearchReportData[] }) {
	if (data.length === 0) {
		return null;
	}
	const visible = data.slice(0, MAX_RENDERED_ITEMS);
	const hiddenCount = data.length - visible.length;
	return (
		<CardShell title="分析师研报">
			<div className="flex flex-col gap-3">
				{visible.map((item, index) => (
					<ResearchCard item={item} key={researchKey(item, index)} />
				))}
			</div>
			{hiddenCount > 0 ? (
				<p className="text-muted-foreground text-xs">+{hiddenCount} more</p>
			) : null}
		</CardShell>
	);
}
