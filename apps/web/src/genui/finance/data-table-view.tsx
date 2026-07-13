import { motion } from "motion/react";
import type { ReactNode } from "react";
import { DataTableChart } from "./data-table-chart";
import { DataTableGrid } from "./data-table-grid";
import type {
	DataTableColumn,
	DataTableProps,
	DataTableView,
	MetricColumn,
} from "./data-table-types";
import { EASE_OUT, TRANSITION_MS } from "./motion";
import type { useExpand } from "./use-expand";
import type { useSort } from "./use-sort";

// Phase 1 Task 1 — the Pivot's two branches and the crossfade morph between
// them (design doc §8.1 / §6). Split out of the orchestrator to respect the
// 299-line file cap.

const MS_PER_SECOND = 1000;
const VIEW_FADE_SECONDS = TRANSITION_MS / MS_PER_SECOND;

export interface ViewProps<T> {
	categoryKey: string;
	chartKind: DataTableProps<T>["chartKind"];
	columns: DataTableColumn<T>[];
	expand: ReturnType<typeof useExpand>;
	filteredRows: T[];
	getRowKey: DataTableProps<T>["getRowKey"];
	reduced: boolean;
	renderExpanded?: (row: T) => ReactNode;
	selectedMetrics: MetricColumn<T>[];
	sort: ReturnType<typeof useSort<T>>;
	sortedRows: T[];
	view: DataTableView;
}

/** The grid branch of the Pivot — pure prop-forwarding into DataTableGrid,
 * split out so ViewSwitch stays a thin crossfade wrapper. */
function GridBranch<T>(props: ViewProps<T>) {
	return (
		<DataTableGrid
			categoryKey={props.categoryKey}
			columns={props.columns}
			expand={{
				isExpanded: props.expand.isExpanded,
				onToggle: props.expand.toggle,
				render: props.renderExpanded,
			}}
			getRowKey={props.getRowKey}
			rows={props.sortedRows}
			sort={{
				dir: props.sort.sortDir,
				key: props.sort.sortKey ? String(props.sort.sortKey) : undefined,
				onToggle: (key) => props.sort.toggleSort(key as keyof T),
			}}
		/>
	);
}

/** Table ⇄ chart crossfade morph (§6). Keyed by `view` so switching mounts the
 * new branch and fades it in; a client re-slice (sort/filter) never remounts
 * it, so entrance never replays (Guardrail 1). Reduced-motion snaps instantly. */
export function ViewSwitch<T>(props: ViewProps<T>) {
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
				<DataTableChart
					categoryKey={props.categoryKey}
					chartKind={props.chartKind ?? "line"}
					metrics={props.selectedMetrics}
					rows={props.filteredRows}
				/>
			) : (
				<GridBranch {...props} />
			)}
		</motion.div>
	);
}
