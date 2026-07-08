import type { EconomicEvent } from "../types";

export class NotConfiguredError extends Error {}

const FINNHUB_URL = "https://finnhub.io/api/v1/calendar/economic";
const DATE_LENGTH = 10;
const TIME_START = 11;

interface FhRow {
	actual?: string | null;
	country?: string;
	estimate?: string | null;
	event?: string;
	impact?: string;
	prev?: string | null;
	time?: string;
}

function normalizeRow(row: FhRow): EconomicEvent {
	const time = row.time ?? "";
	return {
		country: row.country ?? "",
		event: row.event ?? "",
		date: time.slice(0, DATE_LENGTH),
		time: time.slice(TIME_START),
		actual: row.actual ?? undefined,
		estimate: row.estimate ?? undefined,
		prior: row.prev ?? undefined,
		impact: row.impact,
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
		throw new NotConfiguredError("FINNHUB_API_KEY is not set");
	}
	const doFetch = opts.fetchImpl ?? fetch;
	const url = `${FINNHUB_URL}?from=${from}&to=${to}&token=${apiKey}`;
	const res = await doFetch(url, { signal: opts.signal });
	if (!res.ok) {
		throw new Error(`finnhub HTTP ${res.status}`);
	}
	const json = (await res.json()) as { economicCalendar?: FhRow[] | null };
	const rows = json.economicCalendar ?? [];
	const wanted = country?.toUpperCase();
	return rows
		.filter((r) => !wanted || (r.country ?? "").toUpperCase() === wanted)
		.map(normalizeRow);
}
