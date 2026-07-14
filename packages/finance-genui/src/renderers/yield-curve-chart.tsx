"use client";

import type { YieldPointData } from "./finance-schemas-fe6";
import { formatDate, formatNum } from "./format";
import { LineSeries } from "./line-series";
import type { LineSeriesSeriesConfig } from "./line-series-types";

// Phase 2 Task 4 — `yield_curve` (国债收益率曲线) on the `LineSeries` archetype
// (design doc §8.3/§9: LineSeries · I·Se·C). The one LineSeries tool whose
// x-axis isn't time — it's maturity/tenor (§8.3 "yield_curve 的 x 是期限非
// 时间 → 关 P,开 C 叠加多日期曲线") — so this component pivots the tool's
// long-format points ({tenor, date, yield} per point) into wide rows (one row
// per tenor, one field per date) before handing them to `LineSeries`: each
// distinct date becomes a `series` entry (a curve across maturities), and the
// Se/Compare chips (only rendered once there's more than one line, per
// line-series-controls.tsx) let the reader overlay curves for comparison. The
// tool as it stands returns one snapshot per call, so today this always
// yields exactly one series (no chips, no Period control — both omitted
// here); the pivot still matters because the payload's own point order isn't
// guaranteed tenor-ascending.

const YIELD_VALUE_DP = 1;

function yieldValueFormat(value: number): string {
	return `${formatNum(value, YIELD_VALUE_DP)}%`;
}

// Tenor → ascending sort key in months, so the x-axis always reads
// short→long maturity. LineSeriesChart's own `orderedForChart` only re-sorts
// a categoryKey that parses fully as a number or a date (see
// line-series-chart.tsx's `parseOrderKey`); tenor labels like "1M"/"10Y"
// match neither, so it silently falls back to source row order instead. Wide
// rows are pre-sorted here rather than relying on that fallback.
const DAYS_PER_MONTH = 30;
const DAYS_PER_WEEK = 7;
const WEEKS_PER_MONTH = DAYS_PER_MONTH / DAYS_PER_WEEK;
const MONTHS_PER_YEAR = 12;
const TENOR_UNIT_MONTHS: Record<string, number> = {
	D: 1 / DAYS_PER_MONTH,
	M: 1,
	W: 1 / WEEKS_PER_MONTH,
	Y: MONTHS_PER_YEAR,
};
const TENOR_RE = /^(\d+(?:\.\d+)?)([DWMY])$/i;

/** Parses a tenor label ("1M"/"10Y"/"6M"…) into a comparable months value.
 * An unparseable label sorts last (after every real tenor) rather than
 * disrupting the rest of the curve's order. */
function tenorSortKey(tenor: string): number {
	const match = TENOR_RE.exec(tenor.trim());
	if (!match) {
		return Number.POSITIVE_INFINITY;
	}
	const [, amount, unit] = match;
	const unitMonths = TENOR_UNIT_MONTHS[unit.toUpperCase()];
	return Number(amount) * unitMonths;
}

interface YieldCurveRow {
	tenor: string;
	[dateKey: string]: string | number | null;
}

/** Pivots long-format points (one per tenor+date) into wide rows (one per
 * tenor, one field per date), sorted ascending by tenor so the chart's x-axis
 * reads short→long maturity regardless of the payload's own point order. */
function toWideRows(data: YieldPointData[]): YieldCurveRow[] {
	const byTenor = new Map<string, YieldCurveRow>();
	for (const point of data) {
		const row = byTenor.get(point.tenor) ?? { tenor: point.tenor };
		row[point.date] = point.yield;
		byTenor.set(point.tenor, row);
	}
	return Array.from(byTenor.values()).sort(
		(a, b) => tenorSortKey(a.tenor) - tenorSortKey(b.tenor)
	);
}

/** One series per distinct date in the payload — a single-date payload
 * yields one series (LineSeries then shows no Se/Compare chips), a
 * multi-date payload yields one overlaid curve per date. */
function toDateSeries(
	data: YieldPointData[]
): LineSeriesSeriesConfig<YieldCurveRow>[] {
	const dates = Array.from(new Set(data.map((point) => point.date))).sort();
	return dates.map((date) => ({ key: date, label: formatDate(date) }));
}

function getRowKey(row: YieldCurveRow): string {
	return row.tenor;
}

/** finance_yield_curve → 国债收益率曲线, x-axis = maturity/tenor (not time),
 * one overlaid line per date present in the payload. */
export function YieldCurveChart({ data }: { data: YieldPointData[] }) {
	if (data.length === 0) {
		return null;
	}
	const rows = toWideRows(data);
	const series = toDateSeries(data);
	const singleDate = series.length === 1 ? series[0]?.label : undefined;
	return (
		<LineSeries<YieldCurveRow>
			categoryKey="tenor"
			getRowKey={getRowKey}
			rows={rows}
			series={series}
			subtitle={singleDate}
			title="国债收益率曲线"
			valueFormat={yieldValueFormat}
		/>
	);
}
