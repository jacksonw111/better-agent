"use client";

import { useMemo } from "react";
import { compositionHueRamp } from "./chart-theme";
import { formatCompact } from "./format";
import { LineSeriesStrip } from "./line-series-controls";
import type {
	LineSeriesProps,
	LineSeriesSeriesConfig,
	ResolvedLineSeries,
} from "./line-series-types";
import { LineSeriesViewSwitch } from "./line-series-view";
import { useReducedMotion } from "./motion";
import { CardShell, type FinTableColumn } from "./primitives";
import { usePeriod } from "./use-period";
import { usePivot } from "./use-pivot";
import { useSeriesSelect } from "./use-series-select";

// Phase 2 Task 3 — the `LineSeries` archetype orchestrator (design doc §8.3:
// LineSeries · I·Se·P·C), the shared primitive holder_count (this task,
// single line) and margin (this task, two-line compare) plug into by
// supplying a series config; yield_curve (a later task) reuses the same
// contract for its C-only multi-date overlay. Composes the Phase 0 kit:
// CardShell + ControlStrip (line-series-controls) + the interaction hooks
// (series-select/period/pivot), and renders a line/area chart or its Pivot
// table (line-series-view). Every verb runs client-side over `rows` — zero
// new tool calls (§11 交互只在 payload 内). Zero border/ring (§5.1).

const FALLBACK_PERIOD_ID = "__all_periods";

/** Default numeric accessor for a series without an explicit `value`: read
 * `row[key]` directly, matching BarSeriesSeries's convention. */
function defaultSeriesValue<T>(key: string): (row: T) => number | null {
	return (row: T) => {
		const raw = (row as Record<string, unknown>)[key];
		return typeof raw === "number" ? raw : null;
	};
}

/** Assigns each line its stable composition-ramp color by index over the
 * FULL series list — computed before Series/Compare narrows visibility, so
 * toggling one line off never shifts another line's hue. A single line gets
 * the ramp's one (deepest, neutral) shade — `compositionHueRamp(1)` — rather
 * than a second hardcoded "neutral" constant (§11 图表 token 单一出口). An
 * explicit `tone` on a series config always wins. */
function resolveSeries<T>(
	series: LineSeriesSeriesConfig<T>[]
): ResolvedLineSeries<T>[] {
	const ramp = compositionHueRamp(series.length);
	return series.map((s, index) => ({
		color: s.tone ?? ramp[index],
		key: s.key,
		label: s.label,
		value: s.value ?? defaultSeriesValue<T>(s.key),
	}));
}

function defaultGetRowKey<T>(_row: T, index: number): number {
	return index;
}

interface ViewDefaults<T> {
	area: boolean;
	canPivot: boolean;
	getRowKey: (row: T, index: number) => string | number;
	tableColumns: FinTableColumn<T>[];
	valueFormat: (value: number) => string;
}

/** Consolidates every prop-default resolution (area/getRowKey/valueFormat/
 * tableColumns, plus the canPivot flag derived from them) into one place —
 * keeps the orchestrator's own branch count low (biome/eslint's function
 * complexity cap) by moving these `??` defaults out of the component body. */
function resolveViewDefaults<T>(props: LineSeriesProps<T>): ViewDefaults<T> {
	const tableColumns = props.tableColumns ?? [];
	return {
		area: props.area ?? false,
		canPivot: tableColumns.length > 0,
		getRowKey: props.getRowKey ?? defaultGetRowKey,
		tableColumns,
		valueFormat: props.valueFormat ?? formatCompact,
	};
}

export function LineSeries<T>(props: LineSeriesProps<T>) {
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

	const { area, canPivot, getRowKey, tableColumns, valueFormat } =
		resolveViewDefaults(props);
	const pivot = usePivot({ initial: props.defaultView ?? "chart" });
	const visibleSeries = useMemo(
		() => resolved.filter((s) => seriesSelect.selected.includes(s.key)),
		[resolved, seriesSelect.selected]
	);
	const view = canPivot ? pivot.view : "chart";

	return (
		<CardShell subtitle={props.subtitle} title={props.title}>
			<LineSeriesStrip
				canPivot={canPivot}
				period={period}
				periods={props.periods}
				pivot={pivot}
				series={resolved}
				seriesSelect={seriesSelect}
			/>
			<LineSeriesViewSwitch
				area={area}
				categoryFormat={props.categoryFormat}
				categoryKey={props.categoryKey}
				getRowKey={getRowKey}
				reduced={reduced}
				rows={periodRows}
				tableColumns={tableColumns}
				valueFormat={valueFormat}
				view={view}
				visibleSeries={visibleSeries}
			/>
		</CardShell>
	);
}
