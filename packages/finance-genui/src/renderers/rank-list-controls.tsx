import { ArrowDown, ArrowUp } from "lucide-react";
import type { ReactNode } from "react";
import { Chip } from "./chip";
import { ControlStrip } from "./control-strip";
import {
	ALL_FILTER_ID,
	RANK_METRIC_SORT_ID,
	type RankListFilter,
} from "./rank-list-types";
import { Segmented, type SegmentedOption } from "./segmented";
import type { useFilter } from "./use-filter";
import type { SortDirection, useSort } from "./use-sort";

// Phase 3 Task 5 — the `RankList`'s ControlStrip contents (design doc §3):
// left = the Sort segmented (headline metric + any caller `sortOptions`,
// direction arrow on the active option — mirrors `data-table-grid.tsx`'s
// header sort-icon convention since this archetype has no table header to
// host it in), right = the Filter controls (single-select Segmented with an
// implicit "全部", or multi-select Chips — mirrors `data-table-controls.tsx`'s
// `FilterControls`). Split out of rank-list.tsx to respect the 299-line cap.

const SORT_ICON_SIZE = 14;

function sortDirIcon(direction: SortDirection): ReactNode {
	return direction === "asc" ? (
		<ArrowUp size={SORT_ICON_SIZE} />
	) : (
		<ArrowDown size={SORT_ICON_SIZE} />
	);
}

function sortOptionLabel(
	label: string,
	active: boolean,
	direction: SortDirection
): ReactNode {
	if (!active) {
		return label;
	}
	return (
		<span className="inline-flex items-center gap-1">
			{label}
			{sortDirIcon(direction)}
		</span>
	);
}

export function RankListSort<T>({
	metricLabel,
	sort,
	sortOptionIds,
}: {
	metricLabel: string;
	sort: ReturnType<typeof useSort<T>>;
	sortOptionIds: { id: string; label: string }[];
}) {
	const activeKey = String(sort.sortKey ?? RANK_METRIC_SORT_ID);
	const all = [
		{ id: RANK_METRIC_SORT_ID, label: metricLabel },
		...sortOptionIds,
	];
	const options: SegmentedOption[] = all.map(({ id, label }) => ({
		id,
		label: sortOptionLabel(label, id === activeKey, sort.sortDir),
	}));
	return (
		<Segmented
			onChange={(id) => sort.toggleSort(id as keyof T)}
			options={options}
			value={activeKey}
		/>
	);
}

function SingleFilter<T>({
	active,
	filters,
	onClear,
	onSet,
}: {
	active: string | undefined;
	filters: RankListFilter<T>[];
	onClear: () => void;
	onSet: (id: string) => void;
}) {
	const options = [
		{ id: ALL_FILTER_ID, label: "全部" },
		...filters.map((f) => ({ id: f.id, label: f.label })),
	];
	return (
		<Segmented
			onChange={(id) => (id === ALL_FILTER_ID ? onClear() : onSet(id))}
			options={options}
			value={active ?? ALL_FILTER_ID}
		/>
	);
}

function MultiFilter<T>({
	active,
	filters,
	onToggle,
}: {
	active: string[];
	filters: RankListFilter<T>[];
	onToggle: (id: string) => void;
}) {
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

export function RankListFilterControls<T>({
	filter,
	filterMode,
	filters,
}: {
	filter: ReturnType<typeof useFilter<T>>;
	filterMode: "single" | "multi";
	filters: RankListFilter<T>[];
}) {
	if (filterMode === "single") {
		return (
			<SingleFilter
				active={filter.activeIds[0]}
				filters={filters}
				onClear={filter.clear}
				onSet={filter.setActive}
			/>
		);
	}
	return (
		<MultiFilter
			active={filter.activeIds}
			filters={filters}
			onToggle={filter.toggle}
		/>
	);
}

export function RankListStrip<T>({
	filter,
	filterMode,
	filters,
	metricLabel,
	sort,
	sortOptionIds,
}: {
	filter: ReturnType<typeof useFilter<T>>;
	filterMode: "single" | "multi";
	filters: RankListFilter<T>[];
	metricLabel: string;
	sort: ReturnType<typeof useSort<T>>;
	sortOptionIds: { id: string; label: string }[];
}) {
	return (
		<ControlStrip
			chips={
				filters.length ? (
					<RankListFilterControls
						filter={filter}
						filterMode={filterMode}
						filters={filters}
					/>
				) : null
			}
			primary={
				<RankListSort
					metricLabel={metricLabel}
					sort={sort}
					sortOptionIds={sortOptionIds}
				/>
			}
		/>
	);
}
