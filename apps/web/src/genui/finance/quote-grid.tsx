import { motion } from "motion/react";
import { useState } from "react";
import { staggerContainerVariants, useReducedMotion } from "./motion";
import { QuoteTile, type QuoteTileData } from "./quote-tile";
import { Segmented, type SegmentedOption } from "./segmented";
import { type UseExpandResult, useExpand } from "./use-expand";
import { useSort } from "./use-sort";

// QuoteGrid archetype (design doc §8.8, contract So·E·I) — a responsive grid
// of quote tiles shared by finance_index_quote and finance_commodity.
// Sort (So): source order vs. sorted-by-change (via `useSort`), Expand (E):
// tap a tile for its extra fields (via `useExpand`), Inspect (I): hover tint
// on the tile itself.

const MAX_TILES = 30;

type SortId = "asc" | "desc" | "source";

const SORT_OPTIONS: SegmentedOption[] = [
	{ id: "source", label: "原序" },
	{ id: "desc", label: "涨幅" },
	{ id: "asc", label: "跌幅" },
];

/** The tile cascade itself, split out from `QuoteGrid` to keep that function
 * under the line cap — entrance stagger comes from `staggerContainerVariants`
 * on the container, each `QuoteTile` supplies its own `rowItemVariants`. */
function TileGrid({
	items,
	expand,
	reduced,
}: {
	items: QuoteTileData[];
	expand: UseExpandResult;
	reduced: boolean;
}) {
	return (
		<motion.div
			animate="visible"
			className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4"
			initial="hidden"
			variants={staggerContainerVariants(reduced)}
		>
			{items.map((item) => (
				<QuoteTile
					expanded={expand.isExpanded(item.id)}
					item={item}
					key={item.id}
					onToggle={() => expand.toggle(item.id)}
					reduced={reduced}
				/>
			))}
		</motion.div>
	);
}

/** finance_index_quote / finance_commodity → QuoteGrid. Renders nothing for
 * an empty payload; caps at MAX_TILES since this renders inline in chat, not
 * a full watchlist page. */
export function QuoteGrid({ items }: { items: QuoteTileData[] }) {
	const reduced = useReducedMotion() ?? false;
	const [sortEnabled, setSortEnabled] = useState(false);
	const { sorted, sortDir, toggleSort } = useSort(items, {
		initialKey: "changePct",
	});
	const expand = useExpand();

	if (items.length === 0) {
		return null;
	}

	const hiddenCount = Math.max(items.length - MAX_TILES, 0);
	const displayed = (sortEnabled ? sorted : items).slice(0, MAX_TILES);
	const sortValue: SortId = sortEnabled ? sortDir : "source";

	const handleSortChange = (id: string) => {
		if (id === "source") {
			setSortEnabled(false);
			return;
		}
		setSortEnabled(true);
		if (id !== sortDir) {
			toggleSort("changePct");
		}
	};

	return (
		<div className="flex w-full flex-col gap-2">
			<Segmented
				className="self-start"
				onChange={handleSortChange}
				options={SORT_OPTIONS}
				value={sortValue}
			/>
			<TileGrid expand={expand} items={displayed} reduced={reduced} />
			{hiddenCount > 0 ? (
				<p className="text-muted-foreground text-xs">+{hiddenCount} more</p>
			) : null}
		</div>
	);
}
