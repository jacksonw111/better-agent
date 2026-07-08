import { fetchWithRetry } from "../http";
import type { EarningsEvent } from "../types";

const HKEX_URL = "https://www1.hkexnews.hk/search/titleSearchServlet.do";

// Only these announcement types are treated as earnings-relevant. Exact
// substrings on purpose — e.g. "Allotment Results" must NOT match.
const RESULT_PHRASES = [
	"Interim Results",
	"Final Results",
	"Quarterly Results",
	"Date of Board Meeting",
] as const;

interface HkexRow {
	DATE_TIME?: string;
	LONG_TEXT?: string;
	STOCK_CODE?: string;
	STOCK_NAME?: string;
}

// "07/07/2026 22:48" -> "2026-07-07"
function toIsoDate(dateTime: string): string {
	const datePart = dateTime.split(" ")[0] ?? "";
	const [day, month, year] = datePart.split("/");
	if (!(day && month && year)) {
		return "";
	}
	return `${year}-${month}-${day}`;
}

function matchedPhrase(longText: string): string | null {
	for (const phrase of RESULT_PHRASES) {
		if (longText.includes(phrase)) {
			return phrase;
		}
	}
	return null;
}

function parseRows(result: unknown): HkexRow[] {
	const parsed = typeof result === "string" ? JSON.parse(result) : result;
	return Array.isArray(parsed) ? (parsed as HkexRow[]) : [];
}

export function parseHkexEarnings(json: unknown): EarningsEvent[] {
	const { result } = json as { result?: unknown };
	const rows = parseRows(result);
	const events: EarningsEvent[] = [];
	for (const row of rows) {
		if (!(row.STOCK_CODE && row.LONG_TEXT)) {
			continue;
		}
		const reportType = matchedPhrase(row.LONG_TEXT);
		if (!reportType) {
			continue;
		}
		events.push({
			market: "hk",
			symbol: row.STOCK_CODE,
			name: row.STOCK_NAME ?? "",
			date: toIsoDate(row.DATE_TIME ?? ""),
			reportType,
		});
	}
	return events;
}

// "YYYY-MM-DD" -> "YYYYMMDD"
function toDateParam(date: string): string {
	return date.replaceAll("-", "");
}

export async function hkEarnings(
	date: string,
	opts: { fetchImpl?: typeof fetch; signal?: AbortSignal } = {}
): Promise<EarningsEvent[]> {
	const ymd = toDateParam(date);
	const url =
		`${HKEX_URL}?sortDir=0&sortByOptions=DateTime&category=0&market=SEHK` +
		`&documentType=-1&fromDate=${ymd}&toDate=${ymd}&title=&searchType=1` +
		"&t1code=10000&t2Gcode=-2&t2code=-2&rowRange=500&lang=E";
	try {
		const res = await fetchWithRetry(url, undefined, {
			fetchImpl: opts.fetchImpl,
			signal: opts.signal,
		});
		if (!res.ok) {
			return [];
		}
		return parseHkexEarnings(await res.json());
	} catch {
		return [];
	}
}
