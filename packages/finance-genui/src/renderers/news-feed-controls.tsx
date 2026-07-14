import { Chip } from "./chip";
import { ControlStrip } from "./control-strip";
import type { FeedItem, NewsFeedFilter } from "./news-feed-types";
import { Segmented } from "./segmented";
import type { useFilter } from "./use-filter";
import type { useSort } from "./use-sort";

// Phase 3 Task 3 — the `NewsFeed`'s ControlStrip contents (design doc §3):
// left = the time Sort segmented (最新/最早), right = the Filter chips (only
// rendered when the caller supplied a discrete field to filter by). Split out
// of news-feed.tsx to respect the 299-line file cap.

const SORT_OPTIONS = [
	{ id: "desc", label: "最新" },
	{ id: "asc", label: "最早" },
];

/** Two-state Sort segmented, backed by `useSort`'s toggle semantics: clicking
 * the segment that isn't the current direction flips it; clicking the
 * already-active one is a no-op. */
function TimeSort({ sort }: { sort: ReturnType<typeof useSort<FeedItem>> }) {
	return (
		<Segmented
			onChange={(id) => {
				if (id !== sort.sortDir) {
					sort.toggleSort("time");
				}
			}}
			options={SORT_OPTIONS}
			value={sort.sortDir}
		/>
	);
}

function FilterChips({
	filter,
	filters,
}: {
	filter: ReturnType<typeof useFilter<FeedItem>>;
	filters: NewsFeedFilter[];
}) {
	return (
		<>
			{filters.map((f) => (
				<Chip
					active={filter.isActive(f.id)}
					key={f.id}
					label={f.label}
					onToggle={() => filter.toggle(f.id)}
				/>
			))}
		</>
	);
}

export function NewsFeedStrip({
	filter,
	filters,
	sort,
}: {
	filter: ReturnType<typeof useFilter<FeedItem>>;
	filters: NewsFeedFilter[];
	sort: ReturnType<typeof useSort<FeedItem>>;
}) {
	return (
		<ControlStrip
			chips={
				filters.length ? (
					<FilterChips filter={filter} filters={filters} />
				) : null
			}
			primary={<TimeSort sort={sort} />}
		/>
	);
}
