import {
	centralBankTypeFilter,
	earningsFilter,
	economicCountryFilter,
	economicImpactFilter,
} from "./calendar-list-filters";
import {
	renderCentralBankEvent,
	renderCentralBankExpanded,
	renderEarningsEvent,
	renderEarningsExpanded,
	renderEconomicEvent,
	renderEconomicExpanded,
} from "./calendar-list-rows";
import { EventCalendar } from "./event-calendar";
import type { CalendarEvent } from "./event-calendar-types";
import type { CalendarEventData } from "./finance-schemas-fe7";

// finance_earnings_calendar / finance_economic_calendar / finance_central_bank
// all render through the shared `EventCalendar` archetype (design doc §8.9,
// contract F·So·E) — each tool only ever returns rows of its own shape, so
// the row kind is detected once from the first row's optional fields, then
// the whole array renders with that kind's title/filters/row renderers.

type ListKind = "central-bank" | "earnings" | "economic";

function detectKind(row: CalendarEventData): ListKind {
	if (typeof row.symbol === "string") {
		return "earnings";
	}
	if (typeof row.event === "string") {
		return "economic";
	}
	return "central-bank";
}

function toEvents(
	data: CalendarEventData[]
): CalendarEvent<CalendarEventData>[] {
	return data.map((row, index) => ({
		date: row.date,
		id: `${row.date}-${index}`,
		raw: row,
	}));
}

const TITLE_BY_KIND: Record<ListKind, string> = {
	"central-bank": "央行操作",
	earnings: "财报日历",
	economic: "经济日历",
};

function renderByKind(kind: ListKind, data: CalendarEventData[]) {
	const events = toEvents(data);
	if (kind === "earnings") {
		return (
			<EventCalendar
				events={events}
				primaryFilter={earningsFilter(data)}
				renderEvent={renderEarningsEvent}
				renderExpanded={renderEarningsExpanded}
				title={TITLE_BY_KIND.earnings}
			/>
		);
	}
	if (kind === "economic") {
		return (
			<EventCalendar
				events={events}
				primaryFilter={economicImpactFilter(data)}
				renderEvent={renderEconomicEvent}
				renderExpanded={renderEconomicExpanded}
				secondaryFilter={economicCountryFilter(data)}
				title={TITLE_BY_KIND.economic}
			/>
		);
	}
	return (
		<EventCalendar
			events={events}
			primaryFilter={centralBankTypeFilter(data)}
			renderEvent={renderCentralBankEvent}
			renderExpanded={renderCentralBankExpanded}
			title={TITLE_BY_KIND["central-bank"]}
		/>
	);
}

/** finance_earnings_calendar / finance_economic_calendar /
 * finance_central_bank → one `EventCalendar`, kind picked by the row shape
 * detected on the first row (see detectKind). */
export function CalendarList({ data }: { data: CalendarEventData[] }) {
	if (data.length === 0) {
		return null;
	}
	const first = data[0];
	if (!first) {
		return null;
	}
	return renderByKind(detectKind(first), data);
}
