import { motion } from "motion/react";
import { lazy, type ReactNode, Suspense } from "react";
import type { BarSeriesChartProps } from "./bar-series-chart";
import type {
	BarSeriesColoring,
	ResolvedSeries,
	BarSeriesView as ViewKind,
} from "./bar-series-types";
import { ChartFrame } from "./chart-frame";
import { EASE_OUT, TRANSITION_MS } from "./motion";
import { FinTable, type FinTableColumn } from "./primitives";

// Phase 2 Task 1 — the Pivot's two branches and the crossfade morph between
// them (design doc §8.2 "Pv" / §6), mirroring data-table-view.tsx.

// bar-series-chart.tsx imports recharts at module scope; every BarSeries tool
// would otherwise pull recharts into the eager chat bundle just to render its
// table view. `React.lazy` + `Suspense` defers that import chunk until the
// Pivot actually switches to chart view. The loader's generic component type
// can't survive `React.lazy`'s `ComponentType<any>` constraint, so the render
// call below re-asserts it back to `BarSeriesChartProps<T>` — a type-only
// cast, the runtime component is unchanged.
const LazyBarSeriesChart = lazy(() =>
	import("./bar-series-chart").then((m) => ({ default: m.BarSeriesChart }))
);

const MS_PER_SECOND = 1000;
const VIEW_FADE_SECONDS = TRANSITION_MS / MS_PER_SECOND;

export interface BarSeriesViewProps<T> {
	categoryFormat?: (raw: string) => string;
	categoryKey: string;
	coloring: BarSeriesColoring;
	getRowKey: (row: T, index: number) => string | number;
	reduced: boolean;
	rows: T[];
	tableColumns: FinTableColumn<T>[];
	view: ViewKind;
	/** Filter-narrowed (currently visible) buckets — the chart branch only. The
	 * table branch always shows every `tableColumns` column regardless of
	 * bucket visibility (§8.2: F only isolates the chart read). */
	visibleSeries: ResolvedSeries<T>[];
}

/** Chart ⇄ table crossfade morph (§6). Keyed by `view` so switching mounts
 * the new branch and fades it in; a client re-slice (Filter/Period) never
 * remounts it, so entrance never replays (Guardrail 1). Reduced-motion snaps
 * instantly. */
export function BarSeriesViewSwitch<T>(props: BarSeriesViewProps<T>) {
	const Chart = LazyBarSeriesChart as unknown as (
		chartProps: BarSeriesChartProps<T>
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
						categoryFormat={props.categoryFormat}
						categoryKey={props.categoryKey}
						coloring={props.coloring}
						reduced={props.reduced}
						rows={props.rows}
						series={props.visibleSeries}
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
