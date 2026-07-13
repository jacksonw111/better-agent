"use client";

import { motion } from "motion/react";
import { useMemo } from "react";
import { staggerContainerVariants, useReducedMotion } from "./motion";
import { CardShell } from "./primitives";
import { RankListStrip } from "./rank-list-controls";
import { RankListRow } from "./rank-list-row";
import {
	ALL_FILTER_ID,
	RANK_METRIC_SORT_ID,
	type RankListProps,
} from "./rank-list-types";
import { useExpand } from "./use-expand";
import { useFilter } from "./use-filter";
import { useSort } from "./use-sort";

// Phase 3 Task 5 — the `RankList` archetype orchestrator (design doc §8.6,
// contract So·F·E·I): ranked entities, each row = rank + entity name + a
// headline metric with an inline `ProportionBar` + secondary figures.
// Composes the Phase 0 kit exactly like DataTable/NewsFeed do — CardShell +
// ControlStrip (rank-list-controls) + the three interaction hooks
// (sort/filter/expand). All client-side over `items` — zero new tool calls
// (§11 交互只在 payload 内). Sort/filter orchestration lives here and never
// reaches into row layout (`rank-list-row.tsx`), which is the only
// 1D-row-specific piece the future Heatmap 2D variant (sector_list) swaps
// for a grid-cell renderer while reusing this same data/So/F contract.

/** Shared "+N more" trailer, mirrors `FeedMoreFooter` — factored out so the
 * 4 tool wrappers' MAX_RENDERED_ITEMS cap isn't quadrupled verbatim. */
export function RankListMoreFooter({ count }: { count: number }) {
	return <p className="text-muted-foreground text-xs">+{count} more</p>;
}

/** Filter to the ProportionBar's shared scale: the max headline-metric value
 * across the currently rendered (sorted + filtered) set, so bar widths stay
 * relative to what's actually on screen (design doc §8.6 "占比…相对当前集合"). */
function finiteMax(values: (number | null)[]): number {
	let max = 0;
	for (const value of values) {
		if (value !== null && Number.isFinite(value) && value > max) {
			max = value;
		}
	}
	return max;
}

function buildSortAccessors<T>(
	rankMetric: RankListProps<T>["rankMetric"],
	sortOptions: RankListProps<T>["sortOptions"]
): Partial<Record<keyof T, (row: T) => number | string | null>> {
	const accessors: Partial<
		Record<keyof T, (row: T) => number | string | null>
	> = {};
	accessors[RANK_METRIC_SORT_ID as keyof T] = rankMetric;
	for (const option of sortOptions ?? []) {
		accessors[option.id as keyof T] = option.accessor;
	}
	return accessors;
}

/** All Sort/Filter/Expand state + the derived `rendered` set and its bar
 * `max` — kept as one hook, entirely separate from row/grid rendering, so
 * the future Heatmap 2D variant (sector_list) can call this same hook and
 * plug its own grid-cell renderer in place of `RankListRows` below. */
function useRankListOrchestration<T>({
	filterMode,
	filters,
	items,
	rankMetric,
	sortOptions,
}: Required<
	Pick<
		RankListProps<T>,
		"filterMode" | "filters" | "items" | "rankMetric" | "sortOptions"
	>
>) {
	const accessors = useMemo(
		() => buildSortAccessors(rankMetric, sortOptions),
		[rankMetric, sortOptions]
	);
	const sort = useSort(items, {
		accessors,
		initialKey: RANK_METRIC_SORT_ID as keyof T,
	});
	const filter = useFilter(sort.sorted, filters, {
		initial: filterMode === "single" ? ALL_FILTER_ID : undefined,
		mode: filterMode,
	});
	const expand = useExpand();
	const rendered = filters.length ? filter.filtered : sort.sorted;
	const max = useMemo(
		() => finiteMax(rendered.map((item) => rankMetric(item))),
		[rendered, rankMetric]
	);
	const sortOptionIds = useMemo(
		() => sortOptions.map(({ id, label }) => ({ id, label })),
		[sortOptions]
	);
	return { expand, filter, max, rendered, sort, sortOptionIds };
}

type RowsProps<T> = Pick<
	RankListProps<T>,
	| "getRowKey"
	| "metricLabel"
	| "metricTone"
	| "metricValue"
	| "rankMetric"
	| "renderExpanded"
	| "renderPrimary"
	| "renderSecondary"
> & {
	expand: ReturnType<typeof useExpand>;
	items: T[];
	max: number;
	reduced: boolean;
};

/** Row-layout loop, split out from `RankList` — the only 1D-row-specific
 * piece the future Heatmap 2D variant swaps for a grid-cell renderer. */
function RankListRows<T>({
	expand,
	getRowKey,
	items,
	max,
	metricLabel,
	metricTone,
	metricValue,
	rankMetric,
	reduced,
	renderExpanded,
	renderPrimary,
	renderSecondary,
}: RowsProps<T>) {
	return (
		<>
			{items.map((item, index) => {
				const key = getRowKey(item, index);
				return (
					<RankListRow
						expanded={expand.isExpanded(String(key))}
						item={item}
						key={key}
						max={max}
						metricLabel={metricLabel}
						metricTone={metricTone}
						metricValue={metricValue}
						onToggleExpand={() => expand.toggle(String(key))}
						rank={index + 1}
						rankMetric={rankMetric}
						reduced={reduced}
						renderExpanded={renderExpanded}
						renderPrimary={renderPrimary}
						renderSecondary={renderSecondary}
					/>
				);
			})}
		</>
	);
}

export function RankList<T>(props: RankListProps<T>) {
	const {
		filterMode = "single",
		filters = [],
		footer,
		sortOptions = [],
		subtitle,
		title,
		...rowProps
	} = props;
	const reduced = useReducedMotion() ?? false;
	const { expand, filter, max, rendered, sort, sortOptionIds } =
		useRankListOrchestration({
			filterMode,
			filters,
			sortOptions,
			...rowProps,
		});

	return (
		<CardShell subtitle={subtitle} title={title}>
			<RankListStrip
				filter={filter}
				filterMode={filterMode}
				filters={filters}
				metricLabel={rowProps.metricLabel}
				sort={sort}
				sortOptionIds={sortOptionIds}
			/>
			<motion.div
				animate="visible"
				className="flex flex-col"
				initial="hidden"
				variants={staggerContainerVariants(reduced)}
			>
				<RankListRows
					{...rowProps}
					expand={expand}
					items={rendered}
					max={max}
					reduced={reduced}
				/>
			</motion.div>
			{footer}
		</CardShell>
	);
}
