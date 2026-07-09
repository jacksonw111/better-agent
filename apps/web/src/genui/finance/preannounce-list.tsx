import { Badge } from "@better-agent/ui/components/badge";
import type { PreannounceRowData } from "./finance-schemas-fe13";
import { formatDate, formatPct } from "./format";
import { CardShell, FinTable, type FinTableColumn } from "./primitives";

// finance_earnings_preannounce → 业绩预告. `type` is the management-stated
// predict type (预增/预减/首亏/扭亏/续亏/不确定/...) — colored red for a
// favorable surprise, green for an unfavorable one (红涨绿跌 convention
// extended to earnings direction, not price), muted when the direction isn't
// itself informative (续亏/不确定/其他).

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

const PREANNOUNCE_COLUMNS: FinTableColumn<PreannounceRowData>[] = [
	{
		key: "noticeDate",
		label: "公告日",
		render: (row) => formatDate(row.noticeDate),
	},
	{ key: "name", label: "名称", render: (row) => row.name || row.code || "—" },
	{
		key: "type",
		label: "类型",
		render: (row) => <TypeBadge type={row.type} />,
	},
	{
		align: "right",
		key: "change",
		label: "同比区间",
		render: (row) => formatChangeRange(row.changeLower, row.changeUpper),
	},
	{
		key: "content",
		label: "预告内容",
		render: (row) => (
			<span className="line-clamp-2 max-w-72" title={row.content}>
				{row.content || "—"}
			</span>
		),
	},
];

/** finance_earnings_preannounce → 业绩预告, newest `noticeDate` first (the
 * tool already returns rows in that order). */
export function PreannounceList({ data }: { data: PreannounceRowData[] }) {
	if (data.length === 0) {
		return null;
	}
	return (
		<CardShell title="业绩预告">
			<FinTable
				columns={PREANNOUNCE_COLUMNS}
				getRowKey={(row, index) => `${row.code}-${row.noticeDate}-${index}`}
				rows={data}
			/>
		</CardShell>
	);
}
