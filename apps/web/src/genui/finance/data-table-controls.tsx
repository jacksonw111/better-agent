import { Chip } from "./chip";
import { ControlStrip } from "./control-strip";
import type {
	DataTableProps,
	DataTableView,
	MetricColumn,
} from "./data-table-types";
import { Segmented } from "./segmented";
import type { useFilter } from "./use-filter";
import type { usePeriod } from "./use-period";
import type { usePivot } from "./use-pivot";
import type { useSeriesSelect } from "./use-series-select";

// Phase 1 Task 1 — the `DataTable`'s ControlStrip contents (design doc §3):
// left = [Period?] + [Pivot toggle] (`DataTablePrimary`), right = [Filter
// chips?] + [metric chips] (`DataTableControlChips`). Controls live ONLY here,
// never scattered through the card body (§11 控件只在 ControlStrip). Split out
// of the orchestrator to respect the 299-line file cap.

const ALL_FILTER_ID = "__all";

function FilterControls<T>({
	active,
	filters,
	mode,
	onClear,
	onSet,
	onToggle,
}: {
	active: string[];
	filters: NonNullable<DataTableProps<T>["filters"]>;
	mode: "single" | "multi";
	onClear: () => void;
	onSet: (id: string) => void;
	onToggle: (id: string) => void;
}) {
	if (mode === "single") {
		const options = [
			{ id: ALL_FILTER_ID, label: "全部" },
			...filters.map((f) => ({ id: f.id, label: f.label })),
		];
		return (
			<Segmented
				onChange={(id) => (id === ALL_FILTER_ID ? onClear() : onSet(id))}
				options={options}
				value={active[0] ?? ALL_FILTER_ID}
			/>
		);
	}
	return (
		<>
			{filters.map((f) => (
				<Chip
					active={active.includes(f.id)}
					key={f.id}
					label={f.label}
					onToggle={() => onToggle(f.id)}
				/>
			))}
		</>
	);
}

function MetricChips<T>({
	isSelected,
	metrics,
	onToggle,
}: {
	isSelected: (id: string) => boolean;
	metrics: MetricColumn<T>[];
	onToggle: (id: string) => void;
}) {
	return (
		<>
			{metrics.map((metric) => (
				<Chip
					active={isSelected(metric.key)}
					key={metric.key}
					label={metric.label}
					onToggle={() => onToggle(metric.key)}
					tone={metric.color}
				/>
			))}
		</>
	);
}

export interface StripProps<T> {
	canChart: boolean;
	filter: ReturnType<typeof useFilter<T>>;
	filterMode: "single" | "multi";
	filters: DataTableProps<T>["filters"];
	metrics: MetricColumn<T>[];
	period: ReturnType<typeof usePeriod<string>>;
	periods: DataTableProps<T>["periods"];
	pivot: ReturnType<typeof usePivot>;
	series: ReturnType<typeof useSeriesSelect>;
}

function DataTablePrimary<T>({
	canChart,
	period,
	periods,
	pivot,
}: {
	canChart: boolean;
	period: ReturnType<typeof usePeriod<string>>;
	periods: DataTableProps<T>["periods"];
	pivot: ReturnType<typeof usePivot>;
}) {
	if (!(periods?.length || canChart)) {
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
			{canChart ? (
				<Segmented
					onChange={(id) => pivot.setView(id as DataTableView)}
					options={[
						{ id: "table", label: "表" },
						{ id: "chart", label: "图" },
					]}
					value={pivot.view}
				/>
			) : null}
		</div>
	);
}

function DataTableControlChips<T>({
	canChart,
	filter,
	filterMode,
	filters,
	metrics,
	series,
}: {
	canChart: boolean;
	filter: ReturnType<typeof useFilter<T>>;
	filterMode: "single" | "multi";
	filters: DataTableProps<T>["filters"];
	metrics: MetricColumn<T>[];
	series: ReturnType<typeof useSeriesSelect>;
}) {
	if (!(filters?.length || canChart)) {
		return null;
	}
	return (
		<>
			{filters?.length ? (
				<FilterControls
					active={filter.activeIds}
					filters={filters}
					mode={filterMode}
					onClear={filter.clear}
					onSet={filter.setActive}
					onToggle={filter.toggle}
				/>
			) : null}
			{canChart ? (
				<MetricChips
					isSelected={series.isSelected}
					metrics={metrics}
					onToggle={series.toggle}
				/>
			) : null}
		</>
	);
}

export function DataTableStrip<T>(props: StripProps<T>) {
	return (
		<ControlStrip
			chips={
				<DataTableControlChips
					canChart={props.canChart}
					filter={props.filter}
					filterMode={props.filterMode}
					filters={props.filters}
					metrics={props.metrics}
					series={props.series}
				/>
			}
			primary={
				<DataTablePrimary
					canChart={props.canChart}
					period={props.period}
					periods={props.periods}
					pivot={props.pivot}
				/>
			}
		/>
	);
}
