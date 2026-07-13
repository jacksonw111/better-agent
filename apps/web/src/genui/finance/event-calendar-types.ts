import type { ReactNode } from "react";

// Phase 3 Task 4 — shared types for the `Calendar` archetype (design doc
// §8.9: 按日期分组的事件时间线, contract F·So·E). The 3 finance tools it backs
// (earnings_calendar, economic_calendar, central_bank) each map their own row
// shape onto a `CalendarEvent<T>` envelope — the archetype itself only
// groups/sorts/filters on the envelope's `date`, and hands `raw` back to the
// caller's render callbacks untouched.

export interface CalendarEvent<T> {
	/** Plain "YYYY-MM-DD" (or any `Date`-parseable) date string driving both
	 * the date-group bucketing and the chronological Sort. Time-of-day, when
	 * the source carries one separately (economic's `time`), stays inside
	 * `raw` for the row to render — the group only ever buckets by day. */
	date: string;
	/** Stable per-event identity for the sort/filter/expand hooks and React
	 * `key`s. */
	id: string;
	raw: T;
}

export interface CalendarFilterOption<T> {
	id: string;
	label: string;
	predicate: (event: CalendarEvent<T>) => boolean;
}

/** One filter chip group. `mode` follows `useFilter`'s semantics: "single"
 * (segmented-like, one active option, e.g. 未来/已过) or "multi"
 * (independent toggles, e.g. multiple 地区 at once). Defaults to "single". */
export interface CalendarFilterDimension<T> {
	mode?: "single" | "multi";
	options: CalendarFilterOption<T>[];
}

export interface CalendarProps<T> {
	events: CalendarEvent<T>[];
	footer?: ReactNode;
	/** First (leftmost) filter chip group, e.g. 重要度/未来已过 — omitted
	 * entirely when the tool's payload carries no real discrete field for it
	 * (don't invent a filter, mirrors the DataTable/NewsFeed rule). */
	primaryFilter?: CalendarFilterDimension<T>;
	/** Main row content: time/name + the event's key figures. */
	renderEvent: (raw: T) => ReactNode;
	/** The event's full record, revealed by tapping the row. Presence alone
	 * makes an event's Expand affordance appear. */
	renderExpanded?: (raw: T) => ReactNode;
	/** Second filter chip group, e.g. economic's 地区 alongside 重要度 —
	 * chained (AND) after `primaryFilter`, never OR'd into the same chip
	 * row as an independent dimension would be. */
	secondaryFilter?: CalendarFilterDimension<T>;
	subtitle?: string;
	title: string;
}
