import { Chip } from "./chip";
import { ControlStrip } from "./control-strip";
import type {
	LineSeriesPeriod,
	LineSeriesView,
	ResolvedLineSeries,
} from "./line-series-types";
import { Segmented } from "./segmented";
import type { usePeriod } from "./use-period";
import type { usePivot } from "./use-pivot";
import type { useSeriesSelect } from "./use-series-select";

// Phase 2 Task 3 — the `LineSeries`'s ControlStrip contents (design doc §3):
// left = [Period?] + [Pivot toggle?] (`LineSeriesPrimary`), right = [Series/
// Compare chips, only when there's more than one line] (`LineSeriesChips`).
// Split out of the orchestrator to respect the 299-line file cap, mirroring
// bar-series-controls.tsx.

function LineSeriesPrimary<T>({
	canPivot,
	period,
	periods,
	pivot,
}: {
	canPivot: boolean;
	period: ReturnType<typeof usePeriod<string>>;
	periods: LineSeriesPeriod<T>[] | undefined;
	pivot: ReturnType<typeof usePivot>;
}) {
	if (!(periods?.length || canPivot)) {
		return null;
	}
	return (
		<div className="flex items-center gap-2">
			{periods?.length ? (
				<Segmented
					onChange={period.setPeriod}
					options={periods.map((p) => ({ id: p.id, label: p.label }))}
					value={period.period}
				/>
			) : null}
			{canPivot ? (
				<Segmented
					onChange={(id) => pivot.setView(id as LineSeriesView)}
					options={[
						{ id: "chart", label: "图" },
						{ id: "table", label: "表" },
					]}
					value={pivot.view}
				/>
			) : null}
		</div>
	);
}

function LineSeriesChips<T>({
	series,
	seriesSelect,
}: {
	series: ResolvedLineSeries<T>[];
	seriesSelect: ReturnType<typeof useSeriesSelect>;
}) {
	return (
		<>
			{series.map((s) => (
				<Chip
					active={seriesSelect.isSelected(s.key)}
					key={s.key}
					label={s.label}
					onToggle={() => seriesSelect.toggle(s.key)}
					tone={s.color}
				/>
			))}
		</>
	);
}

export interface LineSeriesStripProps<T> {
	canPivot: boolean;
	period: ReturnType<typeof usePeriod<string>>;
	periods: LineSeriesPeriod<T>[] | undefined;
	pivot: ReturnType<typeof usePivot>;
	series: ResolvedLineSeries<T>[];
	seriesSelect: ReturnType<typeof useSeriesSelect>;
}

/** §8.3: "多线时图例即 Series chips" — a single-line chart shows no chips, so
 * the right slot is only populated once there's more than one line to
 * compare. */
export function LineSeriesStrip<T>(props: LineSeriesStripProps<T>) {
	return (
		<ControlStrip
			chips={
				props.series.length > 1 ? (
					<LineSeriesChips
						series={props.series}
						seriesSelect={props.seriesSelect}
					/>
				) : undefined
			}
			primary={
				<LineSeriesPrimary
					canPivot={props.canPivot}
					period={props.period}
					periods={props.periods}
					pivot={props.pivot}
				/>
			}
		/>
	);
}
