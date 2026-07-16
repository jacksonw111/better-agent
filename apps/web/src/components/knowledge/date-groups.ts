// Pure day-bucketing for the knowledge list: newest-first items in, ordered
// groups out. Kept free of React/DOM so it's trivially unit-testable.

export interface DateGroup<T> {
	items: T[];
	/** "Today" / "Yesterday" / "Jul 14, 2026" */
	label: string;
}

const groupDayFormatter = new Intl.DateTimeFormat(undefined, {
	dateStyle: "medium",
});

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function daysAgo(date: Date, now: Date): number {
	const startOf = (d: Date) =>
		new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
	return Math.round((startOf(now) - startOf(date)) / MS_PER_DAY);
}

function dayLabel(date: Date, now: Date): string {
	const distance = daysAgo(date, now);
	if (distance === 0) {
		return "Today";
	}
	if (distance === 1) {
		return "Yesterday";
	}
	return groupDayFormatter.format(date);
}

/** Buckets items (assumed sorted newest-first) into calendar-day groups,
 * preserving order. `now` is injectable for tests. */
export function groupByDay<T>(
	items: T[],
	getDate: (item: T) => Date,
	now: Date = new Date()
): DateGroup<T>[] {
	const groups: DateGroup<T>[] = [];
	let currentKey: string | null = null;
	for (const item of items) {
		const date = getDate(item);
		const key = `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
		if (key !== currentKey) {
			currentKey = key;
			groups.push({ label: dayLabel(date, now), items: [] });
		}
		groups.at(-1)?.items.push(item);
	}
	return groups;
}
