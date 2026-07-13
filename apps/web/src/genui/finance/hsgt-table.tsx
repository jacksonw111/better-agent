"use client";

import { BarSeries } from "./bar-series";
import type { BarSeriesSeries } from "./bar-series-types";
import type { HsgtRowData } from "./finance-schemas";
import { changeColor, formatCompact, formatDate } from "./format";
import type { FinTableColumn } from "./primitives";

// Phase 2 Task 2 — `hsgt_flow` on the `BarSeries` archetype (design doc §9:
// "北向/南向,F 沪/深/港股通"). The tool returns a long-format row per
// (tradeDate, channel) — one of 沪股通/深股通 (北向) or 港股通(沪)/港股通(深)/
// 南向合计 (南向) — but BarSeries wants one row per category (date) with each
// series read off a column on that row, so `buildChartRows` pivots the long
// format into `HsgtChartRow`s first, same shape money_flow already gets for
// free from its API. §5.3 picks `coloring="composition"`: the four channels
// are compared side by side (which channel is driving flow today), not a
// single net direction, mirroring money_flow's 超大/大/中/小单. Isolating one
// channel via its Filter chip still recovers sign coloring automatically
// (bar-series-chart.tsx's `effectiveColoring`).

// EastMoney reports HSGT flow amounts in 万元 (ten-thousand-yuan units); scale
// up to raw yuan before handing to `formatCompact`, which auto-picks the
// 万/亿/万亿 suffix from the magnitude.
const WAN_TO_YUAN = 1e4;

interface HsgtChartRow {
	gangguTongHu: number | null; // 港股通(沪) (南向)
	gangguTongShen: number | null; // 港股通(深) (南向)
	huguTong: number | null; // 沪股通 (北向)
	shenguTong: number | null; // 深股通 (北向)
	tradeDate: string;
}

type ChartField = Exclude<keyof HsgtChartRow, "tradeDate">;

// "南向合计" (006) is EastMoney's own sum of 港股通(沪) + 港股通(深) — it isn't
// a distinct capital channel, so it's intentionally left out of both the
// series and the pivot table: charting it alongside its two components would
// double-count 南向 flow.
const CHANNEL_FIELD: Record<string, ChartField> = {
	沪股通: "huguTong",
	深股通: "shenguTong",
	"港股通(沪)": "gangguTongHu",
	"港股通(深)": "gangguTongShen",
};

function emptyChartRow(tradeDate: string): HsgtChartRow {
	return {
		gangguTongHu: null,
		gangguTongShen: null,
		huguTong: null,
		shenguTong: null,
		tradeDate,
	};
}

/** Pivots the long-format API rows (one row per channel per date) into one
 * `HsgtChartRow` per `tradeDate`, preserving the tool's own newest-first
 * date order (Map insertion order tracks first-seen date). */
function buildChartRows(rows: HsgtRowData[]): HsgtChartRow[] {
	const byDate = new Map<string, HsgtChartRow>();
	for (const row of rows) {
		const field = CHANNEL_FIELD[row.channel];
		if (!field) {
			continue;
		}
		const existing = byDate.get(row.tradeDate) ?? emptyChartRow(row.tradeDate);
		existing[field] = row.netAmt;
		byDate.set(row.tradeDate, existing);
	}
	return [...byDate.values()];
}

const HSGT_SERIES: BarSeriesSeries<HsgtChartRow>[] = [
	{ key: "huguTong", label: "沪股通" },
	{ key: "shenguTong", label: "深股通" },
	{ key: "gangguTongHu", label: "港股通(沪)" },
	{ key: "gangguTongShen", label: "港股通(深)" },
];

function netCellStyle(value: number | null): { color?: string } {
	return { color: changeColor(value) ?? undefined };
}

function NetFlowCell({ value }: { value: number | null }) {
	if (value === null) {
		return <span className="text-muted-foreground">—</span>;
	}
	return (
		<span style={netCellStyle(value)}>
			{formatCompact(value * WAN_TO_YUAN, { cny: true })}
		</span>
	);
}

const HSGT_COLUMNS: FinTableColumn<HsgtChartRow>[] = [
	{
		key: "tradeDate",
		label: "日期",
		render: (row) => formatDate(row.tradeDate),
	},
	{
		align: "right",
		key: "huguTong",
		label: "沪股通",
		render: (row) => <NetFlowCell value={row.huguTong} />,
	},
	{
		align: "right",
		key: "shenguTong",
		label: "深股通",
		render: (row) => <NetFlowCell value={row.shenguTong} />,
	},
	{
		align: "right",
		key: "gangguTongHu",
		label: "港股通(沪)",
		render: (row) => <NetFlowCell value={row.gangguTongHu} />,
	},
	{
		align: "right",
		key: "gangguTongShen",
		label: "港股通(深)",
		render: (row) => <NetFlowCell value={row.gangguTongShen} />,
	},
];

const NORTH_DISCLOSURE_NOTE = "北向资金净流入自2024年8月19日起不再披露";

/** finance_hsgt_flow → 沪深港通资金流 by channel (design doc §9 "北向/南向,F
 * 沪/深/港股通"). Northbound (沪股通/深股通) net flow is null on every row
 * since mainland exchanges stopped disclosing it on 2024-08-19 — a subtitle
 * note surfaces that instead of the bare dashes reading as missing data. */
export function HsgtTable({ data }: { data: HsgtRowData[] }) {
	if (data.length === 0) {
		return null;
	}
	const hasSuppressedNorth = data.some(
		(row) => row.direction === "north" && row.netAmt === null
	);
	const chartRows = buildChartRows(data);
	if (chartRows.length === 0) {
		return null;
	}
	return (
		<BarSeries<HsgtChartRow>
			categoryFormat={formatDate}
			categoryKey="tradeDate"
			coloring="composition"
			getRowKey={(row) => row.tradeDate}
			rows={chartRows}
			series={HSGT_SERIES}
			subtitle={hasSuppressedNorth ? NORTH_DISCLOSURE_NOTE : undefined}
			tableColumns={HSGT_COLUMNS}
			title="沪深港通资金流"
		/>
	);
}
