import { fetchWithRetry } from "../http";
import type { EconomicEvent } from "../types";

export class NotConfiguredError extends Error {}

const FRED_URL = "https://api.stlouisfed.org/fred/releases/dates";
const FRED_LIMIT = 1000;
const US_COUNTRY = "US";

const KEY_RELEASES: string[] = [
	"consumer price index",
	"producer price index",
	"employment situation",
	"gross domestic product",
	"personal income and outlays",
	"advance monthly sales for retail",
	"job openings and labor turnover",
	"industrial production",
	"new residential construction",
	"consumer sentiment",
	"employment cost index",
];

interface FredReleaseDate {
	date?: string;
	release_id?: number;
	release_name?: string;
}

function buildUrl(from: string, to: string, apiKey: string): string {
	const params = new URLSearchParams({
		api_key: apiKey,
		file_type: "json",
		include_release_dates_with_no_data: "true",
		sort_order: "asc",
		limit: String(FRED_LIMIT),
		realtime_start: from,
		realtime_end: to,
	});
	return `${FRED_URL}?${params.toString()}`;
}

function normalizeRow(row: FredReleaseDate): EconomicEvent {
	return {
		country: US_COUNTRY,
		event: row.release_name ?? "",
		date: row.date ?? "",
	};
}

function applyEventFilter(
	events: EconomicEvent[],
	opts: { all?: boolean; event?: string }
): EconomicEvent[] {
	if (opts.event) {
		const needle = opts.event.toLowerCase();
		return events.filter((e) => e.event.toLowerCase().includes(needle));
	}
	if (opts.all === true) {
		return events;
	}
	return events.filter((e) => {
		const name = e.event.toLowerCase();
		return KEY_RELEASES.some((substr) => name.includes(substr));
	});
}

export async function economicCalendar(
	from: string,
	to: string,
	apiKey: string,
	country: string | undefined,
	opts: {
		all?: boolean;
		event?: string;
		fetchImpl?: typeof fetch;
		signal?: AbortSignal;
	} = {}
): Promise<EconomicEvent[]> {
	if (!apiKey) {
		throw new NotConfiguredError("FRED_API_KEY is not set");
	}
	if (country && country.toUpperCase() !== US_COUNTRY) {
		return [];
	}
	const url = buildUrl(from, to, apiKey);
	const res = await fetchWithRetry(url, undefined, {
		fetchImpl: opts.fetchImpl,
		signal: opts.signal,
	});
	if (!res.ok) {
		throw new Error(`fred HTTP ${res.status}`);
	}
	const json = (await res.json()) as {
		release_dates?: FredReleaseDate[] | null;
	};
	const rows = json.release_dates ?? [];
	const events = rows
		.filter(
			(r): r is FredReleaseDate & { date: string } =>
				typeof r.date === "string" && r.date >= from && r.date <= to
		)
		.map(normalizeRow);
	return applyEventFilter(events, opts);
}
