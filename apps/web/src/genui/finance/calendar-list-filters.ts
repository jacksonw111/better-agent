import type { CalendarFilterDimension } from "./event-calendar-types";
import type { CalendarEventData } from "./finance-schemas-fe7";

// Phase 3 Task 4 — the Filter chip dimensions for the 3 finance_earnings_
// calendar / finance_economic_calendar / finance_central_bank tools sharing
// the `EventCalendar` archetype (design doc §8.9 "F 未来/已过、重要度/地区、
// 央行/事件"). Each builder only returns a dimension when the field it reads
// is actually present on at least one row — mirrors the DataTable/NewsFeed
// rule of never inventing a filter for a field the payload doesn't carry.
// Split out of calendar-list.tsx to respect the 299-line file cap.

const IMPACT_LABEL: Record<string, string> = {
	high: "高",
	low: "低",
	med: "中",
	medium: "中",
};

/** earnings_calendar's sole discrete field (design doc "F 未来/已过"): rows
 * report their own publish state via `isPublished`. */
export function earningsFilter(
	data: CalendarEventData[]
): CalendarFilterDimension<CalendarEventData> | undefined {
	const hasField = data.some((row) => typeof row.isPublished === "boolean");
	if (!hasField) {
		// biome-ignore lint/complexity/noUselessUndefined: explicit so every path returns a value (eslint consistent-return)
		return undefined;
	}
	return {
		mode: "single",
		options: [
			{
				id: "future",
				label: "未来",
				predicate: (event) => event.raw.isPublished !== true,
			},
			{
				id: "past",
				label: "已过",
				predicate: (event) => event.raw.isPublished === true,
			},
		],
	};
}

/** economic_calendar's 重要度 dimension — one option per distinct `impact`
 * value present, single-select (design doc "F 重要度/地区"). */
export function economicImpactFilter(
	data: CalendarEventData[]
): CalendarFilterDimension<CalendarEventData> | undefined {
	const values = new Set<string>();
	for (const row of data) {
		if (row.impact) {
			values.add(row.impact.toLowerCase());
		}
	}
	if (values.size === 0) {
		// biome-ignore lint/complexity/noUselessUndefined: explicit so every path returns a value (eslint consistent-return)
		return undefined;
	}
	return {
		mode: "single",
		options: [...values].map((value) => ({
			id: value,
			label: IMPACT_LABEL[value] ?? value,
			predicate: (event) => event.raw.impact?.toLowerCase() === value,
		})),
	};
}

/** economic_calendar's 地区 dimension — one chip per distinct `country`,
 * multi-select so several regions can be shown at once. */
export function economicCountryFilter(
	data: CalendarEventData[]
): CalendarFilterDimension<CalendarEventData> | undefined {
	const values = new Set<string>();
	for (const row of data) {
		if (row.country) {
			values.add(row.country);
		}
	}
	if (values.size === 0) {
		// biome-ignore lint/complexity/noUselessUndefined: explicit so every path returns a value (eslint consistent-return)
		return undefined;
	}
	return {
		mode: "multi",
		options: [...values].map((value) => ({
			id: value,
			label: value,
			predicate: (event) => event.raw.country === value,
		})),
	};
}

/** central_bank's sole discrete field (design doc "F 央行/事件"): one chip
 * per distinct operation `type` present (e.g. 逆回购/MLF). */
export function centralBankTypeFilter(
	data: CalendarEventData[]
): CalendarFilterDimension<CalendarEventData> | undefined {
	const values = new Set<string>();
	for (const row of data) {
		if (row.type) {
			values.add(row.type);
		}
	}
	if (values.size === 0) {
		// biome-ignore lint/complexity/noUselessUndefined: explicit so every path returns a value (eslint consistent-return)
		return undefined;
	}
	return {
		mode: "single",
		options: [...values].map((value) => ({
			id: value,
			label: value,
			predicate: (event) => event.raw.type === value,
		})),
	};
}
