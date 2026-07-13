import type {
	BarSeriesPeriod,
	BarSeriesView,
	ResolvedSeries,
} from "./bar-series-types";
import { Chip } from "./chip";
import { ControlStrip } from "./control-strip";
import { Segmented } from "./segmented";
import type { usePeriod } from "./use-period";
import type { usePivot } from "./use-pivot";
import type { useSeriesSelect } from "./use-series-select";

// Phase 2 Task 1 — the `BarSeries`'s ControlStrip contents (design doc §3):
// left = [Period?] + [Pivot toggle] (`BarSeriesPrimary`), right = [bucket
// Filter chips] (`BarSeriesChips`). Split out of the orchestrator to respect
// the 299-line file cap, mirroring data-table-controls.tsx.

function BarSeriesPrimary<T>({
	canPivot,
	period,
	periods,
	pivot,
}: {
	canPivot: boolean;
	period: ReturnType<typeof usePeriod<string>>;
	periods: BarSeriesPeriod<T>[] | undefined;
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
					onChange={(id) => pivot.setView(id as BarSeriesView)}
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

function BarSeriesChips<T>({
	series,
	seriesSelect,
}: {
	series: ResolvedSeries<T>[];
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

export interface BarSeriesStripProps<T> {
	canPivot: boolean;
	period: ReturnType<typeof usePeriod<string>>;
	periods: BarSeriesPeriod<T>[] | undefined;
	pivot: ReturnType<typeof usePivot>;
	series: ResolvedSeries<T>[];
	seriesSelect: ReturnType<typeof useSeriesSelect>;
}

export function BarSeriesStrip<T>(props: BarSeriesStripProps<T>) {
	return (
		<ControlStrip
			chips={
				<BarSeriesChips
					series={props.series}
					seriesSelect={props.seriesSelect}
				/>
			}
			primary={
				<BarSeriesPrimary
					canPivot={props.canPivot}
					period={props.period}
					periods={props.periods}
					pivot={props.pivot}
				/>
			}
		/>
	);
}
