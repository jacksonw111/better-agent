// A-share 停复牌 (trading halt/resume) via EastMoney's datacenter-web report
// API. VERIFIED live during research — this report REQUIRES a filter
// containing DATETIME (the query day, defaulting to today) plus MARKET, or
// it returns no rows. Currently-halted / recently-resumed, newest first.
import { fetchWithRetry } from "../http";
import type { SuspensionRow } from "../types-events";

const EM_URL = "https://datacenter-web.eastmoney.com/api/data/v1/get";
const REPORT_NAME = "RPT_CUSTOM_SUSPEND_DATA_INTERFACE";
const DATE_LENGTH = 10;
const DEFAULT_LIMIT = 30;
const MAX_LIMIT = 100;

interface RawSuspensionRow {
	PREDICT_RESUME_DATE?: string | null;
	SECURITY_CODE?: string | null;
	SECURITY_NAME_ABBR?: string | null;
	SUSPEND_END_TIME?: string | null;
	SUSPEND_EXPIRE?: string | null;
	SUSPEND_REASON?: string | null;
	SUSPEND_START_TIME?: string | null;
}

interface SuspensionOpts {
	fetchImpl?: typeof fetch;
	now?: number;
	signal?: AbortSignal;
}

function safeDate(value: string | null | undefined): string | null {
	return value ? value.slice(0, DATE_LENGTH) : null;
}

function toRow(row: RawSuspensionRow): SuspensionRow {
	return {
		code: row.SECURITY_CODE ?? "",
		name: row.SECURITY_NAME_ABBR ?? "",
		suspendStart: row.SUSPEND_START_TIME
			? row.SUSPEND_START_TIME.slice(0, DATE_LENGTH)
			: "",
		suspendEnd: safeDate(row.SUSPEND_END_TIME),
		expire: row.SUSPEND_EXPIRE ?? null,
		reason: row.SUSPEND_REASON ?? null,
		predictResume: safeDate(row.PREDICT_RESUME_DATE),
	};
}

function clampLimit(limit: number): number {
	if (!Number.isFinite(limit) || limit <= 0) {
		return DEFAULT_LIMIT;
	}
	return Math.min(Math.floor(limit), MAX_LIMIT);
}

// The filter's Chinese text and quotes must survive URL-encoding intact —
// build the query with URLSearchParams so `全部` / `'...'` are percent-encoded
// correctly instead of left raw in the URL.
function buildUrl(size: number, now: number): string {
	const today = new Date(now).toISOString().slice(0, DATE_LENGTH);
	const filter = `(MARKET="全部")(DATETIME='${today}')`;
	const params = new URLSearchParams({
		reportName: REPORT_NAME,
		columns: "ALL",
		filter,
		pageSize: String(size),
		pageNumber: "1",
		sortColumns: "SUSPEND_START_TIME",
		sortTypes: "-1",
	});
	return `${EM_URL}?${params.toString()}`;
}

export async function getSuspension(
	limit: number = DEFAULT_LIMIT,
	opts: SuspensionOpts = {}
): Promise<SuspensionRow[]> {
	const size = clampLimit(limit);
	try {
		const url = buildUrl(size, opts.now ?? Date.now());
		const res = await fetchWithRetry(
			url,
			{ headers: { Referer: "https://data.eastmoney.com/" } },
			{ fetchImpl: opts.fetchImpl, signal: opts.signal }
		);
		if (!res.ok) {
			return [];
		}
		const json = (await res.json()) as {
			result?: { data?: RawSuspensionRow[] } | null;
		};
		const rows = json.result?.data ?? [];
		return rows.map(toRow);
	} catch {
		return [];
	}
}
