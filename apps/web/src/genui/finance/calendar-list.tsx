import { Badge } from "@better-agent/ui/components/badge";
import type { CalendarEventData } from "./finance-schemas-fe7";
import { formatCompact, formatDate, formatRatio } from "./format";
import { CardShell, FinTable, type FinTableColumn } from "./primitives";

// finance_earnings_calendar / finance_economic_calendar / finance_central_bank
// all return an array, and each tool only ever returns rows of its own shape
// (see CalendarEventSchema) — the row kind is detected once from the first
// row's optional fields, then the whole array renders through one FinTable
// column set for that kind.

type ListKind = "central-bank" | "earnings" | "economic";

function detectKind(row: CalendarEventData): ListKind {
	if (typeof row.symbol === "string") {
		return "earnings";
	}
	if (typeof row.event === "string") {
		return "economic";
	}
	return "central-bank";
}

type ImpactVariant = "default" | "destructive" | "outline";

const IMPACT_VARIANT: Record<string, ImpactVariant> = {
	high: "destructive",
	low: "outline",
	med: "default",
	medium: "default",
};

function ImpactBadge({ impact }: { impact: string | null | undefined }) {
	if (!impact) {
		return <span className="text-muted-foreground">—</span>;
	}
	const variant = IMPACT_VARIANT[impact.toLowerCase()] ?? "outline";
	return <Badge variant={variant}>{impact}</Badge>;
}

const EARNINGS_COLUMNS: FinTableColumn<CalendarEventData>[] = [
	{ key: "date", label: "日期", render: (row) => formatDate(row.date) },
	{ key: "symbol", label: "代码", render: (row) => row.symbol || "—" },
	{ key: "name", label: "名称", render: (row) => row.name || "—" },
	{ key: "session", label: "时段", render: (row) => row.session || "—" },
	{
		key: "reportType",
		label: "类型",
		render: (row) => row.reportType || "—",
	},
];

const ECONOMIC_COLUMNS: FinTableColumn<CalendarEventData>[] = [
	{ key: "date", label: "日期", render: (row) => formatDate(row.date) },
	{ key: "country", label: "国家", render: (row) => row.country || "—" },
	{ key: "event", label: "事件", render: (row) => row.event || "—" },
	{
		align: "right",
		key: "prior",
		label: "前值",
		render: (row) => row.prior || "—",
	},
	{
		align: "right",
		key: "estimate",
		label: "预期",
		render: (row) => row.estimate || "—",
	},
	{
		align: "right",
		key: "actual",
		label: "实际",
		render: (row) => row.actual || "—",
	},
	{
		key: "impact",
		label: "影响",
		render: (row) => <ImpactBadge impact={row.impact} />,
	},
];

const CENTRAL_BANK_COLUMNS: FinTableColumn<CalendarEventData>[] = [
	{ key: "date", label: "日期", render: (row) => formatDate(row.date) },
	{ key: "type", label: "类型", render: (row) => row.type || "—" },
	{
		align: "right",
		key: "amount",
		label: "金额",
		render: (row) => formatCompact(row.amount),
	},
	{
		align: "right",
		key: "rate",
		label: "利率",
		render: (row) => formatRatio(row.rate),
	},
	{ key: "tenor", label: "期限", render: (row) => row.tenor || "—" },
];

const COLUMNS_BY_KIND: Record<ListKind, FinTableColumn<CalendarEventData>[]> = {
	"central-bank": CENTRAL_BANK_COLUMNS,
	earnings: EARNINGS_COLUMNS,
	economic: ECONOMIC_COLUMNS,
};

const TITLE_BY_KIND: Record<ListKind, string> = {
	"central-bank": "央行操作",
	earnings: "财报日历",
	economic: "经济日历",
};

/** finance_earnings_calendar / finance_economic_calendar /
 * finance_central_bank → one FinTable, columns picked by the row shape
 * detected on the first row (see detectKind). */
export function CalendarList({ data }: { data: CalendarEventData[] }) {
	if (data.length === 0) {
		return null;
	}
	const first = data[0];
	if (!first) {
		return null;
	}
	const kind = detectKind(first);
	return (
		<CardShell title={TITLE_BY_KIND[kind]}>
			<FinTable
				columns={COLUMNS_BY_KIND[kind]}
				getRowKey={(row, index) => `${row.date}-${index}`}
				rows={data}
			/>
		</CardShell>
	);
}
