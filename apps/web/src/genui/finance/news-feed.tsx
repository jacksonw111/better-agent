"use client";

import { motion } from "motion/react";
import { staggerContainerVariants, useReducedMotion } from "./motion";
import { NewsFeedStrip } from "./news-feed-controls";
import { FeedRow } from "./news-feed-row";
import type { FeedItem, NewsFeedProps } from "./news-feed-types";
import { CardShell } from "./primitives";
import { useExpand } from "./use-expand";
import { useFilter } from "./use-filter";
import { useSort } from "./use-sort";

// Phase 3 Task 3 — the `NewsFeed` archetype orchestrator (design doc §8.10,
// contract F·So·E): a chronological title+time+source feed shared by
// finance_news / finance_stock_news / finance_research / finance_list_reports.
// Composes the Phase 0 kit exactly like DataTable does — CardShell +
// ControlStrip (news-feed-controls) + the three interaction hooks
// (sort/filter/expand). All client-side over `items` — zero new tool calls
// (§11 交互只在 payload 内). Empty-data short-circuiting is the caller's job
// (mirrors DataTable's tool wrappers, e.g. block-trades-table.tsx), not this
// archetype's — keeps every hook call unconditional.

/** `Date.parse` timestamp for the time Sort; unparseable strings sink to the
 * bottom regardless of direction (matches `useSort`'s missing-value rule). */
function timeMs(item: FeedItem): number {
	const parsed = Date.parse(item.time);
	return Number.isNaN(parsed) ? Number.NEGATIVE_INFINITY : parsed;
}

/** Shared "+N more" trailer for the 4 tool wrappers' MAX_RENDERED_ITEMS cap —
 * factored out so the identical snippet isn't tripled across news-list.tsx /
 * research-list.tsx / reports-list.tsx. */
export function FeedMoreFooter({ count }: { count: number }) {
	return <p className="text-muted-foreground text-xs">+{count} more</p>;
}

export function NewsFeed({
	filters = [],
	footer,
	items,
	subtitle,
	title,
}: NewsFeedProps) {
	const reduced = useReducedMotion() ?? false;
	const sort = useSort(items, {
		accessors: { time: timeMs },
		initialKey: "time",
	});
	const filter = useFilter(sort.sorted, filters, { mode: "multi" });
	const expand = useExpand();

	return (
		<CardShell subtitle={subtitle} title={title}>
			<NewsFeedStrip filter={filter} filters={filters} sort={sort} />
			<motion.div
				animate="visible"
				className="flex flex-col gap-2"
				initial="hidden"
				variants={staggerContainerVariants(reduced)}
			>
				{filter.filtered.map((item) => (
					<FeedRow
						expanded={expand.isExpanded(item.id)}
						item={item}
						key={item.id}
						onToggleExpand={() => expand.toggle(item.id)}
						reduced={reduced}
					/>
				))}
			</motion.div>
			{footer}
		</CardShell>
	);
}
