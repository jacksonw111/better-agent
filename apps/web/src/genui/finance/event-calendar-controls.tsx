import { Chip } from "./chip";
import { ControlStrip } from "./control-strip";
import type {
	CalendarEvent,
	CalendarFilterDimension,
} from "./event-calendar-types";
import { Segmented } from "./segmented";
import type { useFilter } from "./use-filter";
import type { useSort } from "./use-sort";

// Phase 3 Task 4 — the `Calendar`'s ControlStrip contents (design doc §3):
// left = the date Sort segmented (即将/最近), right = up to two chained filter
// chip groups (primary + secondary — e.g. economic's 重要度 + 地区). Split out
// of event-calendar.tsx to respect the 299-line file cap.

const SORT_OPTIONS = [
	{ id: "asc", label: "即将" },
	{ id: "desc", label: "最近" },
];

/** Two-state Sort segmented, backed by `useSort`'s toggle semantics: clicking
 * the segment that isn't the current direction flips it; clicking the
 * already-active one is a no-op. */
function DateSort<T>({
	sort,
}: {
	sort: ReturnType<typeof useSort<CalendarEvent<T>>>;
}) {
	return (
		<Segmented
			onChange={(id) => {
				if (id !== sort.sortDir) {
					sort.toggleSort("date");
				}
			}}
			options={SORT_OPTIONS}
			value={sort.sortDir}
		/>
	);
}

function FilterChips<T>({
	dimension,
	filter,
}: {
	dimension: CalendarFilterDimension<T>;
	filter: ReturnType<typeof useFilter<CalendarEvent<T>>>;
}) {
	return (
		<>
			{dimension.options.map((option) => (
				<Chip
					active={filter.isActive(option.id)}
					key={option.id}
					label={option.label}
					onToggle={() => filter.toggle(option.id)}
				/>
			))}
		</>
	);
}

export function EventCalendarStrip<T>({
	primary,
	primaryFilter,
	secondary,
	secondaryFilter,
	sort,
}: {
	primary: ReturnType<typeof useFilter<CalendarEvent<T>>>;
	primaryFilter: CalendarFilterDimension<T> | undefined;
	secondary: ReturnType<typeof useFilter<CalendarEvent<T>>>;
	secondaryFilter: CalendarFilterDimension<T> | undefined;
	sort: ReturnType<typeof useSort<CalendarEvent<T>>>;
}) {
	const hasChips =
		Boolean(primaryFilter?.options.length) ||
		Boolean(secondaryFilter?.options.length);
	return (
		<ControlStrip
			chips={
				hasChips ? (
					<>
						{primaryFilter?.options.length ? (
							<FilterChips dimension={primaryFilter} filter={primary} />
						) : null}
						{secondaryFilter?.options.length ? (
							<FilterChips dimension={secondaryFilter} filter={secondary} />
						) : null}
					</>
				) : null
			}
			primary={<DateSort sort={sort} />}
		/>
	);
}
