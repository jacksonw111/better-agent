import type { FinTableColumn } from "./primitives";

// Phase 2 Task 1 — shared types for the `BarSeries` archetype primitive
// (design doc §8.2 "I·F·P·Pv"). money_flow (this task) plugs in first;
// hsgt_flow and margin (later tasks) reuse the same contract.

/** One bar series ("档"/bucket), e.g. money_flow's 超大单/大单/中单/小单.
 * `value` defaults to the raw numeric `row[key]` when omitted — set it only
 * when the series' numeric value isn't a direct field read, mirroring
 * DataTableColumn's `value` convention. */
export interface BarSeriesSeries<T> {
	key: string;
	label: string;
	value?: (row: T) => number | null;
}

/** §5.3 grouped-bar coloring rule: "direction" (sign color, zero-axis splits
 * +/-) vs "composition" (one hue ramp per series, deep→light; sign is still
 * shown by the zero axis, never by color). A caller picks exactly one — never
 * both in the same chart. When `coloring: "composition"` and the Filter
 * chips isolate it down to a single visible series, BarSeriesChart switches
 * that lone series to sign color internally (direction is then unambiguous),
 * which is the fix for money_flow's "四档全红" bug (§5.3, §0 病根 #3). */
export type BarSeriesColoring = "sign" | "composition";

/** A 年/季-style period selector — same shape as DataTablePeriod. */
export interface BarSeriesPeriod<T> {
	id: string;
	label: string;
	predicate: (row: T) => boolean;
}

export type BarSeriesView = "chart" | "table";

export interface BarSeriesProps<T> {
	/** Formats the chart's category axis ticks + tooltip label (e.g. a date
	 * string → a locale-formatted label). Display-only. */
	categoryFormat?: (raw: string) => string;
	categoryKey: string;
	/** §5.3 — the question this chart answers. */
	coloring: BarSeriesColoring;
	defaultView?: BarSeriesView;
	/** Defaults to the row's array index when omitted. */
	getRowKey?: (row: T, index: number) => string | number;
	/** Optional Period segmented control (design doc §3 "Period"). */
	periods?: BarSeriesPeriod<T>[];
	rows: T[];
	/** The bar series (buckets) — become Filter chips (design doc §3 "Filter":
	 * toggling hides/shows a bucket in the chart). */
	series: BarSeriesSeries<T>[];
	subtitle?: string;
	/** Pivot's table branch (design doc §3 "Pivot"). Omitted → no Pivot
	 * toggle, chart-only. */
	tableColumns?: FinTableColumn<T>[];
	title: string;
}

/** A series resolved with its stable composition-ramp color, assigned by
 * index over the FULL series list (before Filter narrows visibility) so
 * toggling one bucket never shifts another bucket's hue — and its numeric
 * accessor defaulted to `row[key]` when the caller didn't supply one. */
export interface ResolvedSeries<T> {
	color: string;
	key: string;
	label: string;
	value: (row: T) => number | null;
}
