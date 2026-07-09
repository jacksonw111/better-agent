"use client";

import type { ReactNode } from "react";
import {
	CartesianGrid,
	Line,
	LineChart,
	ResponsiveContainer,
	Tooltip,
	XAxis,
	YAxis,
} from "recharts";
import type {
	MacroCnRowData,
	MacroDashboardRowData,
	MacroObservationData,
	MacroResultData,
} from "./finance-schemas-fe7";
import { formatCompact, formatDate, formatNum } from "./format";
import {
	CardShell,
	ChangePct,
	FinTable,
	type FinTableColumn,
	StatGrid,
	type StatGridItem,
} from "./primitives";

// finance_macro_us / finance_macro_cn share one panel because their result is
// a 3-way union (see MacroResultSchema): a dashboard of every indicator (US
// or CN row shape), a US single-indicator FRED time series, or a CN
// single-indicator EastMoney report history. Each branch below is its own
// small component so none of them grows past a reasonable complexity budget.

const CHART_HEIGHT = 200;
const TICK_FONT_SIZE = 11;
const LINE_STROKE_WIDTH = 2;
const DOT_RADIUS = 3;
const LINE_COLOR = "#3b82f6"; // neutral blue — not a signed change series.
const GRID_COLOR = "var(--border)";
const MAX_TABLE_ROWS = 12;

const TOOLTIP_STYLE = {
	background: "var(--popover)",
	border: "1px solid var(--border)",
	borderRadius: "8px",
	fontSize: "12px",
} as const;

const INDICATOR_LABEL: Record<string, string> = {
	core_cpi: "核心CPI",
	cpi: "CPI",
	cpi_yoy: "CPI同比",
	fed_funds: "联邦基金利率",
	gdp: "GDP",
	industrial: "工业产出",
	m2: "M2货币供应",
	nonfarm: "非农就业",
	pce: "PCE",
	pmi: "PMI",
	ppi: "PPI",
	real_gdp: "实际GDP",
	retail_sales: "零售销售",
	treasury_10y: "10年期国债收益率",
	treasury_2y: "2年期国债收益率",
	unemployment: "失业率",
};

function indicatorLabel(indicator: string): string {
	return INDICATOR_LABEL[indicator] ?? indicator;
}

// CN field keys come straight from apps/finance-mcp/src/core/eastmoney/macro.ts
// REPORTS: "pct" fields are YoY/MoM/cumulative growth rates (colored,
// directional), "index" fields are PMI-style diffusion indices (plain
// number), everything else is an absolute level (万/亿-scale amount).
type CnFieldKind = "amount" | "index" | "pct";

const CN_FIELD_META: Record<string, { kind: CnFieldKind; label: string }> = {
	cumulative: { kind: "pct", label: "累计同比" },
	gdp: { kind: "amount", label: "GDP总量" },
	m0: { kind: "amount", label: "M0" },
	m0Yoy: { kind: "pct", label: "M0同比" },
	m1: { kind: "amount", label: "M1" },
	m1Yoy: { kind: "pct", label: "M1同比" },
	m2: { kind: "amount", label: "M2" },
	m2Yoy: { kind: "pct", label: "M2同比" },
	manufacturing: { kind: "index", label: "制造业PMI" },
	mom: { kind: "pct", label: "环比" },
	nonManufacturing: { kind: "index", label: "非制造业PMI" },
	yoy: { kind: "pct", label: "同比" },
};

function cnFieldLabel(key: string): string {
	return CN_FIELD_META[key]?.label ?? key;
}

function formatCnFieldValue(
	key: string,
	value: number | string | null | undefined
): ReactNode {
	if (typeof value === "string") {
		return value || "—";
	}
	if (value === null || value === undefined) {
		return "—";
	}
	const kind = CN_FIELD_META[key]?.kind ?? "amount";
	if (kind === "pct") {
		return <ChangePct value={value} />;
	}
	if (kind === "index") {
		return formatNum(value);
	}
	return formatCompact(value);
}

function cnRowFields(row: MacroCnRowData): string[] {
	return Object.keys(row).filter((key) => key !== "time");
}

/** Picks one representative field to summarize a CN indicator's latest
 * report for the dashboard StatGrid: prefers `yoy` (the field most CN
 * indicators expose), then the first other non-null field. */
function pickCnPrimaryField(
	latest: MacroCnRowData | null
): { key: string; value: number | string | null } | null {
	if (!latest) {
		return null;
	}
	if (latest.yoy !== null && latest.yoy !== undefined) {
		return { key: "yoy", value: latest.yoy };
	}
	for (const key of cnRowFields(latest)) {
		const value = latest[key];
		if (value !== null && value !== undefined) {
			return { key, value };
		}
	}
	return null;
}

function dashboardItem(row: MacroDashboardRowData): StatGridItem {
	const label = indicatorLabel(row.indicator);
	if ("latest" in row) {
		const primary = pickCnPrimaryField(row.latest);
		return {
			label,
			value: primary ? formatCnFieldValue(primary.key, primary.value) : "—",
		};
	}
	return { label, value: formatNum(row.value) };
}

function MacroDashboardGrid({ rows }: { rows: MacroDashboardRowData[] }) {
	if (rows.length === 0) {
		return null;
	}
	return (
		<CardShell title="宏观指标">
			<StatGrid cols={3} items={rows.map(dashboardItem)} />
		</CardShell>
	);
}

function MacroSeriesBody({ data }: { data: MacroObservationData[] }) {
	return (
		<ResponsiveContainer height={CHART_HEIGHT} width="100%">
			<LineChart data={data} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
				<CartesianGrid stroke={GRID_COLOR} strokeDasharray="3 3" />
				<XAxis
					dataKey="date"
					stroke="var(--muted-foreground)"
					tick={{ fontSize: TICK_FONT_SIZE }}
					tickFormatter={formatDate}
				/>
				<YAxis
					domain={["auto", "auto"]}
					stroke="var(--muted-foreground)"
					tick={{ fontSize: TICK_FONT_SIZE }}
					tickFormatter={(value: number) => formatNum(value)}
				/>
				<Tooltip
					contentStyle={TOOLTIP_STYLE}
					formatter={(value) => [formatNum(Number(value)), "数值"]}
					labelFormatter={(label: string) => formatDate(label)}
				/>
				<Line
					dataKey="value"
					dot={{ fill: LINE_COLOR, r: DOT_RADIUS }}
					stroke={LINE_COLOR}
					strokeWidth={LINE_STROKE_WIDTH}
					type="monotone"
				/>
			</LineChart>
		</ResponsiveContainer>
	);
}

const SERIES_COLUMNS: FinTableColumn<MacroObservationData>[] = [
	{ key: "date", label: "日期", render: (row) => formatDate(row.date) },
	{
		align: "right",
		key: "value",
		label: "数值",
		render: (row) => formatNum(row.value),
	},
];

function MacroSeriesChart({
	indicator,
	seriesId,
	observations,
}: {
	indicator: string;
	seriesId: string | null | undefined;
	observations: MacroObservationData[];
}) {
	if (observations.length === 0) {
		return null;
	}
	return (
		<CardShell
			subtitle={seriesId ?? undefined}
			title={indicatorLabel(indicator)}
		>
			<MacroSeriesBody data={observations} />
			<FinTable
				columns={SERIES_COLUMNS}
				getRowKey={(row, index) => `${row.date}-${index}`}
				rows={observations.slice(0, MAX_TABLE_ROWS)}
			/>
		</CardShell>
	);
}

function cnRowsColumns(
	rows: MacroCnRowData[]
): FinTableColumn<MacroCnRowData>[] {
	const fields = cnRowFields(rows[0] ?? {});
	const timeColumn: FinTableColumn<MacroCnRowData> = {
		key: "time",
		label: "时间",
		render: (row) => formatDate(row.time),
	};
	const fieldColumns: FinTableColumn<MacroCnRowData>[] = fields.map((key) => ({
		align: "right",
		key,
		label: cnFieldLabel(key),
		render: (row) => formatCnFieldValue(key, row[key]),
	}));
	return [timeColumn, ...fieldColumns];
}

function MacroCnRowsTable({
	indicator,
	rows,
}: {
	indicator: string;
	rows: MacroCnRowData[];
}) {
	if (rows.length === 0) {
		return null;
	}
	return (
		<CardShell title={indicatorLabel(indicator)}>
			<FinTable
				columns={cnRowsColumns(rows)}
				getRowKey={(row, index) => `${row.time}-${index}`}
				rows={rows}
			/>
		</CardShell>
	);
}

/** finance_macro_us / finance_macro_cn → branches on which of `dashboard` /
 * `observations` / `rows` the union result carries (see MacroResultSchema).
 */
export function MacroPanel({ data }: { data: MacroResultData }) {
	if (data.dashboard) {
		return <MacroDashboardGrid rows={data.dashboard} />;
	}
	if (data.observations) {
		return (
			<MacroSeriesChart
				indicator={data.indicator ?? ""}
				observations={data.observations}
				seriesId={data.seriesId}
			/>
		);
	}
	if (data.rows) {
		return (
			<MacroCnRowsTable indicator={data.indicator ?? ""} rows={data.rows} />
		);
	}
	return null;
}
