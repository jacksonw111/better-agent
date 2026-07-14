"use client";

import { useMemo } from "react";
import { BarSeriesStrip } from "./bar-series-controls";
import type {
	BarSeriesProps,
	BarSeriesSeries,
	ResolvedSeries,
} from "./bar-series-types";
import { BarSeriesViewSwitch } from "./bar-series-view";
import { compositionHueRamp } from "./chart-theme";
import { useReducedMotion } from "./motion";
import { CardShell } from "./primitives";
import { usePeriod } from "./use-period";
import { usePivot } from "./use-pivot";
import { useSeriesSelect } from "./use-series-select";

// Phase 2 Task 1 — the `BarSeries` archetype orchestrator (design doc §8.2),
// the shared primitive money_flow (this task), hsgt_flow, and margin (later
// tasks) plug into by supplying a series config. Composes the Phase 0 kit:
// CardShell + ControlStrip (bar-series-controls) + the interaction hooks
// (series-select/period/pivot), and renders a grouped bar chart or its Pivot
// table (bar-series-view). Every verb runs client-side over `rows` — zero new
// tool calls (§11 交互只在 payload 内). Zero border/ring (§5.1).

const FALLBACK_PERIOD_ID = "__all_periods";

/** Default numeric accessor for a series without an explicit `value`: read
 * `row[key]` directly, matching DataTableColumn's convention. */
function defaultSeriesValue<T>(key: string): (row: T) => number | null {
	return (row: T) => {
		const raw = (row as Record<string, unknown>)[key];
		return typeof raw === "number" ? raw : null;
	};
}

/** Assigns each series its stable composition-ramp color by index over the
 * FULL series list — computed before Filter narrows visibility, so toggling
 * one bucket off never shifts another bucket's hue. */
function resolveSeries<T>(series: BarSeriesSeries<T>[]): ResolvedSeries<T>[] {
	const ramp = compositionHueRamp(series.length);
	return series.map((s, index) => ({
		color: ramp[index],
		key: s.key,
		label: s.label,
		value: s.value ?? defaultSeriesValue<T>(s.key),
	}));
}

function defaultGetRowKey<T>(_row: T, index: number): number {
	return index;
}

export function BarSeries<T>(props: BarSeriesProps<T>) {
	const reduced = useReducedMotion() ?? false;
	const resolved = useMemo(() => resolveSeries(props.series), [props.series]);
	const seriesIds = useMemo(() => resolved.map((s) => s.key), [resolved]);
	const seriesSelect = useSeriesSelect(seriesIds, { initial: seriesIds });

	const periodIds = (props.periods ?? []).map((p) => p.id);
	const period = usePeriod(periodIds.length ? periodIds : [FALLBACK_PERIOD_ID]);
	const periodRows = useMemo(() => {
		const active = props.periods?.find((p) => p.id === period.period);
		return active ? props.rows.filter(active.predicate) : props.rows;
	}, [props.rows, props.periods, period.period]);

	const canPivot = (props.tableColumns?.length ?? 0) > 0;
	const pivot = usePivot({ initial: props.defaultView ?? "chart" });
	const visibleSeries = useMemo(
		() => resolved.filter((s) => seriesSelect.selected.includes(s.key)),
		[resolved, seriesSelect.selected]
	);
	const getRowKey = props.getRowKey ?? defaultGetRowKey;

	return (
		<CardShell subtitle={props.subtitle} title={props.title}>
			<BarSeriesStrip
				canPivot={canPivot}
				period={period}
				periods={props.periods}
				pivot={pivot}
				series={resolved}
				seriesSelect={seriesSelect}
			/>
			<BarSeriesViewSwitch
				categoryFormat={props.categoryFormat}
				categoryKey={props.categoryKey}
				coloring={props.coloring}
				getRowKey={getRowKey}
				reduced={reduced}
				rows={periodRows}
				tableColumns={props.tableColumns ?? []}
				view={canPivot ? pivot.view : "chart"}
				visibleSeries={visibleSeries}
			/>
		</CardShell>
	);
}
