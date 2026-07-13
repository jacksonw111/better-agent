import { Badge } from "@better-agent/ui/components/badge";
import type { DataTableColumn, DataTableFilter } from "./data-table-types";
import type { PreannounceRowData } from "./finance-schemas-fe13";
import { formatDate, formatPct } from "./format";
import type { StatGridItem } from "./primitives";

// Phase 1 Batch B4 — column config for `earnings_preannounce` (design doc
// §9), ported field-for-field from the pre-DataTable preannounce-list.tsx's
// FinTable columns. `noticeDate` (公告日, the column the pre-DataTable
// component led with) is the categoryKey. `type` is the management-stated
// predict type (预增/预减/首亏/扭亏/续亏/不确定/...) — colored red for a
// favorable surprise, green for an unfavorable one (红涨绿跌 convention
// extended to earnings direction, not price), muted when the direction isn't
// itself informative (续亏/不确定/其他); `TONE_BY_TYPE`/`TypeBadge` carry
// over unchanged from the pre-DataTable component. `type` also backs the
// 预增/预减 single-select `PREANNOUNCE_FILTERS` below (spec §9: "the
// 预增/预减 filter should derive from a schema field"). `changeLower`/
// `changeUpper` render as the combined 同比区间 cell they always have, with
// `value` set to their midpoint so the column is sortable by 净利变动幅度
// (spec §9: "So [sort] by 净利变动幅度") — a percentage range rather than a
// money size, so — like top_holders' `changeRatio` — it stays sortable-only,
// not `isMetric` (no Pivot chart). No `isMetric` means
// `metric-expand.ts`'s `expandedMetricFields` would return nothing, so
// `preannounceExpandedItems` below builds the row-detail expand directly
// from every non-category column's own `render`, mirroring
// `top-holders-columns.tsx`'s `holderExpandedItems`.

type BadgeTone = "favorable" | "unfavorable" | "muted";

const TONE_BY_TYPE: Record<string, BadgeTone> = {
	不确定: "muted",
	扭亏: "favorable",
	续亏: "muted",
	预减: "unfavorable",
	预增: "favorable",
	首亏: "unfavorable",
};

const TONE_STYLE: Record<
	BadgeTone,
	{ borderColor: string; color: string } | undefined
> = {
	favorable: { borderColor: "#ef444440", color: "#ef4444" },
	muted: undefined,
	unfavorable: { borderColor: "#16a34a40", color: "#16a34a" },
};

function TypeBadge({ type }: { type: string }) {
	if (!type) {
		return <span className="text-muted-foreground">—</span>;
	}
	const tone = TONE_BY_TYPE[type] ?? "muted";
	return (
		<Badge style={TONE_STYLE[tone]} variant="outline">
			{type}
		</Badge>
	);
}

function formatChangeRange(lower: number | null, upper: number | null): string {
	if (lower === null && upper === null) {
		return "—";
	}
	return `${formatPct(lower)}~${formatPct(upper)}`;
}

const MIDPOINT_DIVISOR = 2;

function changeMidpoint(
	lower: number | null,
	upper: number | null
): number | null {
	if (lower === null && upper === null) {
		return null;
	}
	if (lower === null) {
		return upper;
	}
	if (upper === null) {
		return lower;
	}
	return (lower + upper) / MIDPOINT_DIVISOR;
}

const NOTICE_DATE_COLUMN: DataTableColumn<PreannounceRowData> = {
	key: "noticeDate",
	label: "公告日",
	render: (row) => formatDate(row.noticeDate),
};

const NAME_COLUMN: DataTableColumn<PreannounceRowData> = {
	key: "name",
	label: "名称",
	render: (row) => row.name || row.code || "—",
};

const TYPE_COLUMN: DataTableColumn<PreannounceRowData> = {
	key: "type",
	label: "类型",
	render: (row) => <TypeBadge type={row.type} />,
};

const CHANGE_COLUMN: DataTableColumn<PreannounceRowData> = {
	align: "right",
	key: "change",
	label: "同比区间",
	render: (row) => formatChangeRange(row.changeLower, row.changeUpper),
	value: (row) => changeMidpoint(row.changeLower, row.changeUpper),
};

const CONTENT_COLUMN: DataTableColumn<PreannounceRowData> = {
	key: "content",
	label: "预告内容",
	render: (row) => (
		<span className="line-clamp-2 max-w-72" title={row.content}>
			{row.content || "—"}
		</span>
	),
};

/** `noticeDate` (categoryKey) plus every column the pre-DataTable component
 * rendered — see the module note above for why `change` is sortable-only,
 * not `isMetric`. */
export function preannounceColumns(): DataTableColumn<PreannounceRowData>[] {
	return [
		NOTICE_DATE_COLUMN,
		NAME_COLUMN,
		TYPE_COLUMN,
		CHANGE_COLUMN,
		CONTENT_COLUMN,
	];
}

/** 预增/预减 single-select filter, derived straight from the management-
 * stated `type` field — the same source `TypeBadge` above reads. */
export const PREANNOUNCE_FILTERS: DataTableFilter<PreannounceRowData>[] = [
	{ id: "increase", label: "预增", predicate: (row) => row.type === "预增" },
	{ id: "decrease", label: "预减", predicate: (row) => row.type === "预减" },
];

/** Row-detail expand for a single preannouncement — every non-category
 * column's own rendered cell (including the full, un-clamped 预告内容 text),
 * so the expand always matches what the grid shows. See the module note for
 * why this can't reuse `expandedMetricFields`. */
export function preannounceExpandedItems(
	columns: DataTableColumn<PreannounceRowData>[],
	row: PreannounceRowData
): StatGridItem[] {
	return columns
		.filter((col) => col.key !== NOTICE_DATE_COLUMN.key)
		.map((col) => ({
			label: col.label,
			value: col.render ? col.render(row) : "—",
		}));
}
