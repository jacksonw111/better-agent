import type { ReactNode } from "react";

// Phase 1 Task 1 — shared types for the `DataTable` primitive (design doc
// §8.1). The archetype 12 finance tools (financial_statements, indicators,
// dividends, earnings_forecast, block/insider trades, convertible_bonds,
// lockup, suspension, ipo, earnings_preannounce, top_holders) each plug into
// by supplying a column config — no tool re-implements sort/filter/pivot.

/** One column of the table. A `value` accessor promotes the column to a
 * numeric one: it enables a numeric `Sort` and, when `isMetric` is set, makes
 * the column a plottable/compare-able chart series driven by a metric chip.
 * Sorting reads the raw primitive at `row[key]` (which `value` also reflects),
 * so a numeric column's `key` must name a real sortable field on the row. */
export interface DataTableColumn<T> {
	align?: "left" | "right" | "center";
	/** Selectable metric → shows as a chip and is plottable as a chart series. */
	isMetric?: boolean;
	key: string;
	label: string;
	/** Display cell. Defaults to the raw `row[key]` value when omitted. */
	render?: (row: T) => ReactNode;
	/** Defaults to `true` when a `value` accessor is present. */
	sortable?: boolean;
	/** Numeric accessor → enables numeric Sort and use as a chart series. */
	value?: (row: T) => number | null;
}

/** A single-select `Segmented` (mode "single") or multi-toggle `Chip` group
 * (mode "multi") filter over rows, applied client-side via `useFilter`. */
export interface DataTableFilter<T> {
	id: string;
	label: string;
	predicate: (row: T) => boolean;
}

/** A 年/季-style period selector rendered as the ControlStrip's left
 * `Segmented`; the active period's `predicate` narrows the rows. */
export interface DataTablePeriod<T> {
	id: string;
	label: string;
	predicate: (row: T) => boolean;
}

/** A metric column resolved with its stable series color (from the shared
 * composition hue ramp), shared by the chart series and its ControlStrip chip
 * so a metric reads the same color in both places. */
export interface MetricColumn<T> extends DataTableColumn<T> {
	color: string;
}

export type DataTableChartKind = "line" | "bar";
export type DataTableView = "table" | "chart";

export interface DataTableProps<T> {
	categoryKey: string;
	chartKind?: DataTableChartKind;
	columns: DataTableColumn<T>[];
	defaultView?: DataTableView;
	filterMode?: "single" | "multi";
	filters?: DataTableFilter<T>[];
	getRowKey: (row: T, index: number) => string | number;
	periods?: DataTablePeriod<T>[];
	renderExpanded?: (row: T) => ReactNode;
	rows: T[];
	subtitle?: string;
	title: string;
}
