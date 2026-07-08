import { fetchWithRetry } from "../http";
import type { EarningsEvent } from "../types";

const NASDAQ_URL = "https://api.nasdaq.com/api/calendar/earnings";
const UA =
	"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

interface NasdaqRow {
	epsForecast?: string;
	name?: string;
	symbol?: string;
	time?: string;
}

function session(time: string | undefined): string | undefined {
	if (time?.includes("pre-market")) {
		return "pre-market";
	}
	return time?.includes("after-hours") ? "after-hours" : undefined;
}

export async function usEarnings(
	date: string,
	opts: { fetchImpl?: typeof fetch; signal?: AbortSignal } = {}
): Promise<EarningsEvent[]> {
	const res = await fetchWithRetry(
		`${NASDAQ_URL}?date=${date}`,
		{ headers: { "User-Agent": UA, Accept: "application/json" } },
		{ fetchImpl: opts.fetchImpl, signal: opts.signal }
	);
	if (!res.ok) {
		throw new Error(`nasdaq HTTP ${res.status}`);
	}
	const json = (await res.json()) as { data?: { rows?: NasdaqRow[] } | null };
	const rows = json.data?.rows ?? [];
	return rows
		.filter((r): r is NasdaqRow & { symbol: string } => Boolean(r.symbol))
		.map((r) => ({
			market: "us" as const,
			symbol: r.symbol,
			name: r.name ?? "",
			date,
			session: session(r.time),
		}));
}
