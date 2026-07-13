import { motion } from "motion/react";
import { lazy, type ReactNode, Suspense } from "react";
import { ChartFrame } from "./chart-frame";
import type { LineSeriesChartProps } from "./line-series-chart";
import type {
	ResolvedLineSeries,
	LineSeriesView as ViewKind,
} from "./line-series-types";
import { EASE_OUT, TRANSITION_MS } from "./motion";
import { FinTable, type FinTableColumn } from "./primitives";

// Phase 2 Task 3 — the Pivot's two branches and the crossfade morph between
// them (design doc §8.3 "C" overlay / §6), mirroring bar-series-view.tsx.

// line-series-chart.tsx imports recharts at module scope; every LineSeries
// tool would otherwise pull recharts into the eager chat bundle just to
// render its table view. `React.lazy` + `Suspense` defers that import chunk
// until the Pivot actually switches to chart view. The loader's generic
// component type can't survive `React.lazy`'s `ComponentType<any>`
// constraint, so the render call below re-asserts it back to
// `LineSeriesChartProps<T>` — a type-only cast, the runtime component is
// unchanged.
const LazyLineSeriesChart = lazy(() =>
	import("./line-series-chart").then((m) => ({ default: m.LineSeriesChart }))
);

const MS_PER_SECOND = 1000;
const VIEW_FADE_SECONDS = TRANSITION_MS / MS_PER_SECOND;

export interface LineSeriesViewProps<T> {
	area: boolean;
	categoryFormat?: (raw: string) => string;
	categoryKey: string;
	getRowKey: (row: T, index: number) => string | number;
	reduced: boolean;
	rows: T[];
	tableColumns: FinTableColumn<T>[];
	valueFormat: (value: number) => string;
	view: ViewKind;
	/** Series/Compare-narrowed (currently visible) lines — the chart branch
	 * only. The table branch always shows every `tableColumns` column
	 * regardless of line visibility (§8.3: Se only isolates the chart read). */
	visibleSeries: ResolvedLineSeries<T>[];
}

/** Chart ⇄ table crossfade morph (§6). Keyed by `view` so switching mounts
 * the new branch and fades it in; a client re-slice (Series/Period change)
 * never remounts it, so entrance never replays (Guardrail 1). Reduced-motion
 * snaps instantly. */
export function LineSeriesViewSwitch<T>(props: LineSeriesViewProps<T>) {
	const Chart = LazyLineSeriesChart as unknown as (
		chartProps: LineSeriesChartProps<T>
	) => ReactNode;
	return (
		<motion.div
			animate={{ opacity: 1 }}
			initial={{ opacity: 0 }}
			key={props.view}
			transition={
				props.reduced
					? { duration: 0 }
					: { duration: VIEW_FADE_SECONDS, ease: EASE_OUT }
			}
		>
			{props.view === "chart" ? (
				<Suspense fallback={<ChartFrame loading>{null}</ChartFrame>}>
					<Chart
						area={props.area}
						categoryFormat={props.categoryFormat}
						categoryKey={props.categoryKey}
						reduced={props.reduced}
						rows={props.rows}
						series={props.visibleSeries}
						valueFormat={props.valueFormat}
					/>
				</Suspense>
			) : (
				<FinTable
					columns={props.tableColumns}
					getRowKey={props.getRowKey}
					rows={props.rows}
				/>
			)}
		</motion.div>
	);
}
