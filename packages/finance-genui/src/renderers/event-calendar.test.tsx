// @vitest-environment jsdom
import { fireEvent, render, within } from "@testing-library/react";
import { expect, it } from "vitest";
import { EventCalendar } from "./event-calendar";
import type {
	CalendarEvent,
	CalendarFilterDimension,
} from "./event-calendar-types";

// Render-level tests for the `Calendar` archetype (design doc §8.9, contract
// F·So·E). jsdom's global test-setup pins `prefers-reduced-motion: reduce`
// (see src/test-setup.ts), so entrance/expand animations settle synchronously
// under these assertions. Follows news-feed.test.tsx's `within(container)`
// convention (no jest-dom matchers configured).

interface Fixture {
	detail?: string;
	name: string;
	region: string;
}

// Dates computed relative to the real clock (rather than hardcoded) so the
// upcoming/recent default assertions hold regardless of when the suite runs.
const HOURS_PER_DAY = 24;
const MINUTES_PER_HOUR = 60;
const SECONDS_PER_MINUTE = 60;
const MS_PER_SECOND = 1000;
const ISO_DATE_LENGTH = 10;
const DAY_MS =
	HOURS_PER_DAY * MINUTES_PER_HOUR * SECONDS_PER_MINUTE * MS_PER_SECOND;
const FUTURE_OFFSET_DAYS = 30;
const isoDate = (ms: number) =>
	new Date(ms).toISOString().slice(0, ISO_DATE_LENGTH);
const PAST_DATE = isoDate(Date.now() - DAY_MS);
const FUTURE_DATE = isoDate(Date.now() + FUTURE_OFFSET_DAYS * DAY_MS);

const EVENTS: CalendarEvent<Fixture>[] = [
	{
		date: PAST_DATE,
		id: "past-1",
		raw: { detail: "老事件详情", name: "老事件", region: "US" },
	},
	{
		date: FUTURE_DATE,
		id: "future-1",
		raw: { detail: "新事件A详情", name: "新事件A", region: "CN" },
	},
	{
		date: FUTURE_DATE,
		id: "future-2",
		raw: { name: "新事件B", region: "US" },
	},
];

const REGION_FILTER: CalendarFilterDimension<Fixture> = {
	mode: "single",
	options: [
		{ id: "US", label: "US", predicate: (event) => event.raw.region === "US" },
		{ id: "CN", label: "CN", predicate: (event) => event.raw.region === "CN" },
	],
};

function renderCalendar(
	overrides: Partial<Parameters<typeof EventCalendar<Fixture>>[0]> = {}
) {
	return render(
		<EventCalendar
			events={EVENTS}
			renderEvent={(raw) => <span>{raw.name}</span>}
			renderExpanded={(raw) => (raw.detail ? <span>{raw.detail}</span> : null)}
			title="事件日历"
			{...overrides}
		/>
	);
}

/** Document-order comparison so the Sort test asserts actual row order
 * without relying on any test-only markup in the production component. */
function isBefore(first: Element, second: Element): boolean {
	const mask = first.compareDocumentPosition(second);
	// biome-ignore lint/suspicious/noBitwiseOperators: compareDocumentPosition returns a bitmask; testing it against DOCUMENT_POSITION_FOLLOWING is the standard DOM idiom, not an accidental `&&` typo.
	return Boolean(mask & Node.DOCUMENT_POSITION_FOLLOWING);
}

it("groups events under their date's header", () => {
	const { container } = renderCalendar();
	const scope = within(container);
	expect(scope.getByText(PAST_DATE)).toBeDefined();
	expect(scope.getByText(FUTURE_DATE)).toBeDefined();
	expect(scope.getByText("老事件")).toBeDefined();
	expect(scope.getByText("新事件A")).toBeDefined();
	expect(scope.getByText("新事件B")).toBeDefined();
});

it("defaults to upcoming-first when the payload has a future event, and toggles to recent-first", () => {
	const { container } = renderCalendar();
	const scope = within(container);
	const pastHeader = () => scope.getByText(PAST_DATE);
	const futureHeader = () => scope.getByText(FUTURE_DATE);

	expect(isBefore(pastHeader(), futureHeader())).toBe(true); // upcoming-first: earliest date leads

	fireEvent.click(scope.getByRole("button", { name: "最近" }));
	expect(isBefore(futureHeader(), pastHeader())).toBe(true); // recent-first now
});

it("defaults to recent-first when every event is in the past", () => {
	const allPast = EVENTS.filter((event) => event.date === PAST_DATE);
	const { container } = renderCalendar({ events: allPast });
	expect(within(container).getByRole("button", { name: "最近" })).toBeDefined();
});

it("narrows events when a filter chip is toggled", () => {
	const { container } = renderCalendar({ primaryFilter: REGION_FILTER });
	const scope = within(container);
	fireEvent.click(scope.getByRole("button", { name: "CN" }));
	expect(scope.getByText("新事件A")).toBeDefined();
	expect(scope.queryByText("老事件")).toBeNull();
	expect(scope.queryByText("新事件B")).toBeNull();
});

it("expands an event to reveal its detail, and offers no toggle when there is none", () => {
	const { container } = renderCalendar();
	const scope = within(container);
	expect(scope.queryByText("老事件详情")).toBeNull();

	const oldRow = scope.getByText("老事件").closest("button");
	expect(oldRow).not.toBeNull();
	fireEvent.click(oldRow as HTMLElement);
	expect(scope.getByText("老事件详情")).toBeDefined();

	// "新事件B" carries no `detail` — renderExpanded returns null for it, so
	// it gets no Expand toggle at all.
	const bRow = scope.getByText("新事件B").closest("button");
	expect(bRow).toBeNull();
});

it("renders no filter chips when the caller supplies none", () => {
	const { container } = renderCalendar();
	expect(within(container).queryByRole("button", { name: "CN" })).toBeNull();
	// Sort still renders — every calendar has a date dimension.
	expect(within(container).getByRole("button", { name: "即将" })).toBeDefined();
});
