// 互动易问答 (cninfo IRM) — investor questions + company replies, the only
// free source for "how did the company respond to X". VERIFIED live during
// research. Two legs: (1) resolve the org id from the stock code, (2) page
// the Q&A list. The step-2 POST requires ALL params in the QUERY STRING with
// an empty body — putting them in the body returns HTTP 400.
import { fetchWithRetry } from "../http";

const KEYBOARD_URL =
	"https://irm.cninfo.com.cn/newircs/index/queryKeyboardInfo";
const QUESTION_URL = "https://irm.cninfo.com.cn/newircs/company/question";
// The IRM backend 500s on requests without a browser User-Agent.
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36";
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;
const HOURS_UTC8 = 8;
const MS_PER_HOUR = 3_600_000;
const UTC8_OFFSET_MS = HOURS_UTC8 * MS_PER_HOUR;
const PAD_WIDTH = 2;
const MONTH_OFFSET = 1;

interface FetchOpts {
	fetchImpl?: typeof fetch;
	signal?: AbortSignal;
}

interface RawQaRow {
	attachedAuthor?: string | null;
	attachedContent?: string | null;
	companyShortName?: string | null;
	mainContent?: string | null;
	pubDate?: number | null;
	stockCode?: string | null;
}

export interface InvestorQaRow {
	answer: string | null;
	answerer: string;
	askTime: string;
	code: string;
	company: string;
	question: string;
}

function clampLimit(limit: number): number {
	if (!Number.isFinite(limit) || limit <= 0) {
		return DEFAULT_LIMIT;
	}
	return Math.min(Math.floor(limit), MAX_LIMIT);
}

function pad(n: number): string {
	return String(n).padStart(PAD_WIDTH, "0");
}

// pubDate is unix MILLISECONDS; render as "YYYY-MM-DD HH:mm" in UTC+8 by
// shifting the epoch and reading UTC getters (no locale involvement).
export function formatUtc8Minute(epochMs: number): string {
	const shifted = new Date(epochMs + UTC8_OFFSET_MS);
	const ymd = `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + MONTH_OFFSET)}-${pad(shifted.getUTCDate())}`;
	return `${ymd} ${pad(shifted.getUTCHours())}:${pad(shifted.getUTCMinutes())}`;
}

async function fetchOrgId(
	code: string,
	opts: FetchOpts
): Promise<string | null> {
	const res = await fetchWithRetry(
		KEYBOARD_URL,
		{
			method: "POST",
			headers: {
				"Content-Type": "application/x-www-form-urlencoded",
				"User-Agent": UA,
			},
			body: new URLSearchParams({ keyWord: code }).toString(),
		},
		{ fetchImpl: opts.fetchImpl, signal: opts.signal }
	);
	if (!res.ok) {
		return null;
	}
	const json = (await res.json()) as {
		data?: { secid?: string | null }[] | null;
	};
	return json.data?.[0]?.secid ?? null;
}

function toQaRow(raw: RawQaRow): InvestorQaRow {
	return {
		code: raw.stockCode ?? "",
		company: raw.companyShortName ?? "",
		question: raw.mainContent ?? "",
		answer: raw.attachedContent ?? null,
		answerer: raw.attachedAuthor ?? "",
		askTime: raw.pubDate ? formatUtc8Minute(raw.pubDate) : "",
	};
}

export async function getInvestorQa(
	code: string,
	limit: number = DEFAULT_LIMIT,
	opts: FetchOpts = {}
): Promise<InvestorQaRow[]> {
	try {
		const orgId = await fetchOrgId(code, opts);
		if (!orgId) {
			return [];
		}
		const params = new URLSearchParams({
			_t: "1",
			stockcode: code,
			orgId,
			pageSize: String(clampLimit(limit)),
			pageNum: "1",
			keyWord: "",
			startDay: "",
			endDay: "",
		});
		// Params in the query string, empty body (body params -> HTTP 400).
		const res = await fetchWithRetry(
			`${QUESTION_URL}?${params.toString()}`,
			{ method: "POST", headers: { "User-Agent": UA } },
			{ fetchImpl: opts.fetchImpl, signal: opts.signal }
		);
		if (!res.ok) {
			return [];
		}
		const json = (await res.json()) as { rows?: RawQaRow[] | null };
		return (json.rows ?? []).map(toQaRow);
	} catch {
		return [];
	}
}
