import type { ReactNode } from "react";
import type { ProportionBarSegment, ProportionBarTone } from "./proportion-bar";

// Phase 3 Task 5 — shared types for the `RankList` archetype (design doc
// §8.6, contract So·F·E·I): ranked entities, each row = rank + entity name +
// a headline metric with an inline `ProportionBar` (bar width ∝ the metric's
// share of the current sorted/filtered set's max, so the ranking is visually
// obvious at a glance) + secondary figures. The 4 tools this task wires
// (cn_hot, etf_list, sector_constituents, search) each map their own row
// shape onto this contract; 3 more RankList tools + a Heatmap 2D variant
// (sector_list, design doc §8.6 "Heatmap 变体") land in the next task by
// reusing this same data/So/F contract with a grid renderer instead of
// `RankListRow` — kept separable: `RankList`'s sort/filter orchestration
// (rank-list.tsx) never reaches into row layout, and `RankListRow`
// (rank-list-row.tsx) is the only 1D-row-specific piece a Heatmap swaps out.

/** Synthetic sort-key id for the auto-added headline-metric Sort option —
 * not a real key of `T` (mirrors `DataTableColumn.value`'s "derived column"
 * pattern documented on `useSort`'s `accessors` option). */
export const RANK_METRIC_SORT_ID = "__rankMetric";

/** The implicit "全部" (all) option for a single-select filter — shared with
 * `rank-list-controls.tsx` so the sentinel isn't a second drifting literal. */
export const ALL_FILTER_ID = "__all";

export interface RankListFilter<T> {
	id: string;
	label: string;
	predicate: (item: T) => boolean;
}

export interface RankListSortOption<T> {
	accessor: (item: T) => number | string | null;
	id: string;
	label: string;
}

export interface RankListProps<T> {
	/** "single" (default): one `Segmented` filter, plus an implicit "全部".
	 * "multi": independent `Chip` toggles. */
	filterMode?: "single" | "multi";
	/** Filter chips over a discrete field — only ever supplied when the
	 * payload actually carries one (mirrors the DataTable/NewsFeed rule:
	 * never invent a filter dimension). Omitted entirely otherwise. */
	filters?: RankListFilter<T>[];
	/** "+N more" style trailer, e.g. from a caller's own MAX_RENDERED_ITEMS cap. */
	footer?: ReactNode;
	getRowKey: (item: T, index: number) => string | number;
	items: T[];
	/** Label for the auto-added headline-metric Sort option and the
	 * ProportionBar's left-side label (e.g. "热度", "成交额", "涨跌幅"). */
	metricLabel: string;
	/** When supplied, the headline line renders as a multi-segment SPLIT
	 * ProportionBar (e.g. sentiment_compare's 看多/看空 bull/bear split, design
	 * doc §9) instead of the single-value `metricTone`/`metricValue` fill —
	 * `metricTone` is then ignored (`ProportionBar` already prioritizes
	 * `segments` over `tone`/`value`). `rankMetric` still drives Sort and the
	 * row's rank order; only the bar's visual changes. */
	metricSegments?: (item: T) => ProportionBarSegment[];
	/** Fixed tone, or a per-row resolver for metrics whose direction varies by
	 * row (e.g. sector_constituents' |涨跌幅| — price tone IS correct there
	 * because the metric literally IS a price move). Every other tool in
	 * this task uses one fixed neutral/probability tone per §11's
	 * axis-purity rule ("情绪/概率各走各的常量,禁止就地 hardcode、禁止跨轴借色"). */
	metricTone?: ProportionBarTone | ((item: T) => ProportionBarTone);
	/** Formats the headline metric's value at the bar's right edge. Omit for
	 * a synthetic/positional metric with no meaningful display value (e.g.
	 * search's relevance-by-position). */
	metricValue?: (item: T) => ReactNode;
	/** Drives the ProportionBar's width (relative to the current
	 * sorted/filtered set's max) and is auto-added as the first Sort option. */
	rankMetric: (item: T) => number | null;
	/** Expand content (design doc "E 下钻" — sector_constituents → 个股快照,
	 * search → quote). Presence alone makes the row's Expand affordance
	 * appear; omit for a tool with nothing further to drill into. */
	renderExpanded?: (item: T) => ReactNode;
	/** The row's rank + entity name area (left side). */
	renderPrimary: (item: T) => ReactNode;
	/** Secondary figures beside the entity (e.g. price, `ChangePct`). */
	renderSecondary?: (item: T) => ReactNode;
	/** Additional Sort criteria beyond the headline metric (e.g. change%). */
	sortOptions?: RankListSortOption<T>[];
	subtitle?: string;
	title: string;
}
