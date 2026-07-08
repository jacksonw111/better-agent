import type { EconomicEvent } from "../types";

export class NotConfiguredError extends Error {}

const FRED_URL = "https://api.stlouisfed.org/fred/releases/dates";
const FRED_LIMIT = 1000;
const US_COUNTRY = "US";

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

export async function economicCalendar(
	from: string,
	to: string,
	apiKey: string,
	country: string | undefined,
	opts: { fetchImpl?: typeof fetch; signal?: AbortSignal } = {}
): Promise<EconomicEvent[]> {
	if (!apiKey) {
		throw new NotConfiguredError("FRED_API_KEY is not set");
	}
	if (country && country.toUpperCase() !== US_COUNTRY) {
		return [];
	}
	const doFetch = opts.fetchImpl ?? fetch;
	const url = buildUrl(from, to, apiKey);
	const res = await doFetch(url, { signal: opts.signal });
	if (!res.ok) {
		throw new Error(`fred HTTP ${res.status}`);
	}
	const json = (await res.json()) as {
		release_dates?: FredReleaseDate[] | null;
	};
	const rows = json.release_dates ?? [];
	return rows
		.filter(
			(r): r is FredReleaseDate & { date: string } =>
				typeof r.date === "string" && r.date >= from && r.date <= to
		)
		.map(normalizeRow);
}
