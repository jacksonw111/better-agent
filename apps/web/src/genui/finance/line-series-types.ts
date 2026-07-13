import type { FinTableColumn } from "./primitives";

// Phase 2 Task 3 — shared types for the `LineSeries` archetype primitive
// (design doc §8.3 "I·Se·P·C"). holder_count (this task) plugs in as a
// single-line chart, margin (this task) as a two-line comparison; yield_curve
// (a later task) reuses the same `series` contract for its C-only (no P)
// multi-date overlay.

/** One line/area series, e.g. margin's 融资余额/融券余额. `value` defaults to
 * the raw numeric `row[key]` when omitted — set it only when the series'
 * numeric value isn't a direct field read, mirroring BarSeriesSeries's
 * `value` convention. `tone` overrides the auto-assigned composition-ramp
 * color for this one series; omit to take the ramp's next hue. */
export interface LineSeriesSeriesConfig<T> {
	key: string;
	label: string;
	tone?: string;
	value?: (row: T) => number | null;
}

/** A 年/季-style period selector — same shape as BarSeriesPeriod. */
export interface LineSeriesPeriod<T> {
	id: string;
	label: string;
	predicate: (row: T) => boolean;
}

export type LineSeriesView = "chart" | "table";

export interface LineSeriesProps<T> {
	/** Area fill under the line(s) (§8.3 "折线/面积"). A caller's judgment
	 * call — e.g. a count trend reads well filled, a balance level less so. */
	area?: boolean;
	/** Formats the chart's category axis ticks + tooltip label (e.g. a date
	 * string → a locale-formatted label). Display-only. */
	categoryFormat?: (raw: string) => string;
	categoryKey: string;
	defaultView?: LineSeriesView;
	/** Defaults to the row's array index when omitted. */
	getRowKey?: (row: T, index: number) => string | number;
	/** Optional Period segmented control (design doc §3 "Period"). Omit for a
	 * chart whose x-axis is already the tool's full time range (both
	 * holder_count and margin), or for yield_curve later whose x-axis isn't
	 * time at all (§8.3: "yield_curve 的 x 是期限非时间 → 关 P"). */
	periods?: LineSeriesPeriod<T>[];
	rows: T[];
	/** The lines — become Series/Compare chips (design doc §3 "Series"/
	 * "Compare") when there's more than one; a single-series chart renders no
	 * chips (§8.3). */
	series: LineSeriesSeriesConfig<T>[];
	subtitle?: string;
	/** Pivot's table branch (design doc §3 "Pivot"). Omitted → no Pivot
	 * toggle, chart-only. LineSeries's contract (§8.3) is I·Se·P·C — Pivot is
	 * optional, included here because both holder_count and margin already
	 * have a natural table view. */
	tableColumns?: FinTableColumn<T>[];
	title: string;
	/** Formats a y-axis tick and a tooltip value. Defaults to `formatCompact`
	 * (no ¥ prefix) — pass e.g. `(v) => formatCompact(v, { cny: true })` for a
	 * CNY-scale balance series like margin's. */
	valueFormat?: (value: number) => string;
}

/** A series resolved with its stable composition-ramp color, assigned by
 * index over the FULL series list (before Series/Compare narrows visibility)
 * so toggling one line never shifts another line's hue — and its numeric
 * accessor defaulted to `row[key]` when the caller didn't supply one. */
export interface ResolvedLineSeries<T> {
	color: string;
	key: string;
	label: string;
	value: (row: T) => number | null;
}
