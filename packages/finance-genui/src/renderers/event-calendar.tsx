"use client";

import { motion } from "motion/react";
import type { ReactNode } from "react";
import { EventCalendarStrip } from "./event-calendar-controls";
import { EventCalendarRow } from "./event-calendar-row";
import type { CalendarEvent, CalendarProps } from "./event-calendar-types";
import { formatDate } from "./format";
import {
	rowItemVariants,
	staggerContainerVariants,
	useReducedMotion,
} from "./motion";
import { CardShell } from "./primitives";
import { useExpand } from "./use-expand";
import { useFilter } from "./use-filter";
import { useSort } from "./use-sort";

// Phase 3 Task 4 — the `Calendar` archetype orchestrator (design doc §8.9,
// contract F·So·E): a chronological event timeline GROUPED BY DATE (date
// section headers, events bucketed under each) shared by finance_earnings_
// calendar / finance_economic_calendar / finance_central_bank. Composes the
// Phase 0 kit exactly like NewsFeed does — CardShell + ControlStrip
// (event-calendar-controls) + the three interaction hooks (sort/filter/
// expand) — but adds the date-grouping skeleton that distinguishes this
// archetype from NewsFeed's flat list. All client-side over `events` — zero
// new tool calls (§11 交互只在 payload 内).

/** `Date.parse` timestamp for the date Sort; unparseable dates sink to the
 * bottom regardless of direction (matches `useSort`'s missing-value rule). */
function dateMs<T>(event: CalendarEvent<T>): number {
	const parsed = Date.parse(event.date);
	return Number.isNaN(parsed) ? Number.POSITIVE_INFINITY : parsed;
}

/** Default Sort direction (design doc §8.9): upcoming-first (asc — soonest
 * future date at top) when the payload has at least one event dated today or
 * later, else recent-first (desc — an all-past payload leads with its newest
 * entry). */
function defaultSortDir<T>(events: CalendarEvent<T>[]): "asc" | "desc" {
	const now = Date.now();
	return events.some((event) => dateMs(event) >= now) ? "asc" : "desc";
}

type CalendarEntry<T> =
	| { date: string; type: "header" }
	| { event: CalendarEvent<T>; type: "event" };

/** Flattens sorted events into header+event entries, one header per date
 * transition — the events are already date-contiguous after `useSort`
 * (equal sort keys land next to each other), so a single pass suffices. */
function buildEntries<T>(events: CalendarEvent<T>[]): CalendarEntry<T>[] {
	const entries: CalendarEntry<T>[] = [];
	let currentDate: string | undefined;
	for (const event of events) {
		if (event.date !== currentDate) {
			entries.push({ date: event.date, type: "header" });
			currentDate = event.date;
		}
		entries.push({ event, type: "event" });
	}
	return entries;
}

function CalendarEntryView<T>({
	entry,
	expand,
	reduced,
	renderEvent,
	renderExpanded,
}: {
	entry: CalendarEntry<T>;
	expand: ReturnType<typeof useExpand>;
	reduced: boolean;
	renderEvent: (raw: T) => ReactNode;
	renderExpanded?: (raw: T) => ReactNode;
}) {
	if (entry.type === "header") {
		return (
			<motion.span
				className="px-2 pt-1 font-medium text-muted-foreground text-xs first:pt-0"
				variants={rowItemVariants(reduced)}
			>
				{formatDate(entry.date)}
			</motion.span>
		);
	}
	return (
		<EventCalendarRow
			event={entry.event}
			expanded={expand.isExpanded(entry.event.id)}
			onToggleExpand={() => expand.toggle(entry.event.id)}
			reduced={reduced}
			renderEvent={renderEvent}
			renderExpanded={renderExpanded}
		/>
	);
}

function CalendarEntryList<T>({
	entries,
	expand,
	reduced,
	renderEvent,
	renderExpanded,
}: {
	entries: CalendarEntry<T>[];
	expand: ReturnType<typeof useExpand>;
	reduced: boolean;
	renderEvent: (raw: T) => ReactNode;
	renderExpanded?: (raw: T) => ReactNode;
}) {
	return (
		<motion.div
			animate="visible"
			className="flex flex-col gap-1"
			initial="hidden"
			variants={staggerContainerVariants(reduced)}
		>
			{entries.map((entry) => (
				<CalendarEntryView
					entry={entry}
					expand={expand}
					key={entry.type === "header" ? `h-${entry.date}` : entry.event.id}
					reduced={reduced}
					renderEvent={renderEvent}
					renderExpanded={renderExpanded}
				/>
			))}
		</motion.div>
	);
}

export function EventCalendar<T>({
	events,
	footer,
	primaryFilter,
	renderEvent,
	renderExpanded,
	secondaryFilter,
	subtitle,
	title,
}: CalendarProps<T>) {
	const reduced = useReducedMotion() ?? false;
	const sort = useSort(events, {
		accessors: { date: dateMs },
		initialDir: defaultSortDir(events),
		initialKey: "date",
	});
	const primary = useFilter(sort.sorted, primaryFilter?.options ?? [], {
		mode: primaryFilter?.mode ?? "single",
	});
	const secondary = useFilter(
		primary.filtered,
		secondaryFilter?.options ?? [],
		{ mode: secondaryFilter?.mode ?? "multi" }
	);
	const expand = useExpand();

	return (
		<CardShell subtitle={subtitle} title={title}>
			<EventCalendarStrip
				primary={primary}
				primaryFilter={primaryFilter}
				secondary={secondary}
				secondaryFilter={secondaryFilter}
				sort={sort}
			/>
			<CalendarEntryList
				entries={buildEntries(secondary.filtered)}
				expand={expand}
				reduced={reduced}
				renderEvent={renderEvent}
				renderExpanded={renderExpanded}
			/>
			{footer}
		</CardShell>
	);
}
