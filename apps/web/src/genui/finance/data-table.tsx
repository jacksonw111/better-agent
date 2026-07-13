"use client";

import { useMemo } from "react";
import { compositionHueRamp } from "./chart-theme";
import { DataTableStrip, type StripProps } from "./data-table-controls";
import type {
	DataTableColumn,
	DataTableProps,
	DataTableView,
	MetricColumn,
} from "./data-table-types";
import { type ViewProps, ViewSwitch } from "./data-table-view";
import { useReducedMotion } from "./motion";
import { CardShell } from "./primitives";
import { useExpand } from "./use-expand";
import { useFilter } from "./use-filter";
import { usePeriod } from "./use-period";
import { usePivot } from "./use-pivot";
import { useSeriesSelect } from "./use-series-select";
import { useSort } from "./use-sort";

// Phase 1 Task 1 — the `DataTable` primitive orchestrator (design doc §8.1),
// the archetype 12 finance tools plug into by supplying a column config. It
// composes the Phase 0 kit: CardShell + ControlStrip (data-table-controls) +
// the eight interaction hooks (sort/filter/period/series/pivot/expand), and
// swaps a sortable grid with a recharts pivot chart (data-table-view). All
// eight verbs run client-side over `rows` — zero new tool calls (§11 交互只在
// payload 内). Zero border/ring (§5.1).

const MOBILE_BREAKPOINT_PX = 640;
const FALLBACK_PERIOD_ID = "__all_periods";

function isNarrowViewport(): boolean {
	if (typeof window === "undefined") {
		return false;
	}
	return window.innerWidth < MOBILE_BREAKPOINT_PX;
}

/** Mobile defaults to the chart view when metrics exist (spec §7: 图对手机友好),
 * unless the caller pins `defaultView` explicitly. */
function initialView<T>(
	defaultView: DataTableView | undefined,
	metrics: DataTableColumn<T>[]
): DataTableView {
	if (defaultView) {
		return defaultView;
	}
	if (metrics.length > 0 && isNarrowViewport()) {
		return "chart";
	}
	return "table";
}

function buildMetricColors<T>(
	columns: DataTableColumn<T>[]
): MetricColumn<T>[] {
	const metrics = columns.filter((col) => col.isMetric);
	const ramp = compositionHueRamp(metrics.length);
	return metrics.map((col, index) => ({ ...col, color: ramp[index] }));
}

/** The fully-derived interaction state the DataTable hooks produce, bundled so
 * the `DataTable` component body stays under the line cap and DataTableBody can
 * fan it out into the strip/view prop shapes. */
interface Orchestration<T> {
	canChart: boolean;
	expand: ReturnType<typeof useExpand>;
	filter: ReturnType<typeof useFilter<T>>;
	filterMode: "single" | "multi";
	metrics: MetricColumn<T>[];
	period: ReturnType<typeof usePeriod<string>>;
	pivot: ReturnType<typeof usePivot>;
	reduced: boolean;
	selectedMetrics: MetricColumn<T>[];
	series: ReturnType<typeof useSeriesSelect>;
	sort: ReturnType<typeof useSort<T>>;
}

function toStripProps<T>(
	source: DataTableProps<T>,
	state: Orchestration<T>
): StripProps<T> {
	return {
		canChart: state.canChart,
		filter: state.filter,
		filterMode: state.filterMode,
		filters: source.filters,
		metrics: state.metrics,
		period: state.period,
		periods: source.periods,
		pivot: state.pivot,
		series: state.series,
	};
}

function toViewProps<T>(
	source: DataTableProps<T>,
	state: Orchestration<T>
): ViewProps<T> {
	return {
		categoryKey: source.categoryKey,
		chartKind: source.chartKind,
		columns: source.columns,
		expand: state.expand,
		filteredRows: state.filter.filtered,
		getRowKey: source.getRowKey,
		reduced: state.reduced,
		renderExpanded: source.renderExpanded,
		selectedMetrics: state.selectedMetrics,
		sort: state.sort,
		sortedRows: state.sort.sorted,
		view: state.pivot.view,
	};
}

/** CardShell + ControlStrip + view crossfade, assembled from the derived
 * orchestration state so the `DataTable` hook body stays under the line cap. */
function DataTableBody<T>({
	source,
	state,
}: {
	source: DataTableProps<T>;
	state: Orchestration<T>;
}) {
	return (
		<CardShell subtitle={source.subtitle} title={source.title}>
			<DataTableStrip {...toStripProps(source, state)} />
			<ViewSwitch {...toViewProps(source, state)} />
		</CardShell>
	);
}

export function DataTable<T>(props: DataTableProps<T>) {
	const reduced = useReducedMotion() ?? false;
	const metrics = useMemo(
		() => buildMetricColors(props.columns),
		[props.columns]
	);
	const filterMode = props.filterMode ?? "single";

	const periodIds = (props.periods ?? []).map((p) => p.id);
	const period = usePeriod(periodIds.length ? periodIds : [FALLBACK_PERIOD_ID]);
	const periodRows = useMemo(() => {
		const active = props.periods?.find((p) => p.id === period.period);
		return active ? props.rows.filter(active.predicate) : props.rows;
	}, [props.rows, props.periods, period.period]);

	const filter = useFilter(periodRows, props.filters ?? [], {
		mode: filterMode,
	});
	const sort = useSort(filter.filtered);
	const series = useSeriesSelect(metrics.map((m) => m.key));
	const pivot = usePivot({ initial: initialView(props.defaultView, metrics) });
	const expand = useExpand({ mode: "single" });

	const state: Orchestration<T> = {
		canChart: metrics.length > 0,
		expand,
		filter,
		filterMode,
		metrics,
		period,
		pivot,
		reduced,
		selectedMetrics: metrics.filter((m) => series.isSelected(m.key)),
		series,
		sort,
	};
	return <DataTableBody source={props} state={state} />;
}
