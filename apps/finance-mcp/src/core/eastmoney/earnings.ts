import type { EarningsEvent, Market } from "../types";
import { usEarnings } from "../us/nasdaq-earnings";

const EM_URL = "https://datacenter-web.eastmoney.com/api/data/v1/get";
const ISO_DATE_LENGTH = 10;

interface AppoinRow {
	ACTUAL_PUBLISH_DATE?: string | null;
	APPOINT_PUBLISH_DATE?: string | null;
	IS_PUBLISH?: string;
	REPORT_TYPE_NAME?: string;
	SECURITY_CODE?: string;
	SECURITY_NAME_ABBR?: string;
}

export async function aShareEarnings(
	reportDate: string,
	opts: { fetchImpl?: typeof fetch; signal?: AbortSignal } = {}
): Promise<EarningsEvent[]> {
	const doFetch = opts.fetchImpl ?? fetch;
	const url =
		`${EM_URL}?reportName=RPT_PUBLIC_BS_APPOIN&columns=ALL&pageSize=50&pageNumber=1` +
		`&sortColumns=FIRST_APPOINT_DATE&sortTypes=1&filter=(REPORT_DATE='${reportDate}')`;
	const res = await doFetch(url, {
		headers: { Referer: "https://data.eastmoney.com/" },
		signal: opts.signal,
	});
	if (!res.ok) {
		throw new Error(`eastmoney HTTP ${res.status}`);
	}
	const json = (await res.json()) as { result?: { data?: AppoinRow[] } | null };
	const rows = json.result?.data ?? [];
	return rows
		.filter((r): r is AppoinRow & { SECURITY_CODE: string } =>
			Boolean(r.SECURITY_CODE)
		)
		.map((r) => {
			const actual = (r.ACTUAL_PUBLISH_DATE ?? "").slice(0, ISO_DATE_LENGTH);
			const appoint = (r.APPOINT_PUBLISH_DATE ?? "").slice(0, ISO_DATE_LENGTH);
			return {
				market: "a" as const,
				symbol: r.SECURITY_CODE,
				name: r.SECURITY_NAME_ABBR ?? "",
				date: actual || appoint,
				reportType: r.REPORT_TYPE_NAME,
				isPublished: r.IS_PUBLISH === "是",
			};
		});
}

export function earningsCalendar(
	market: Market,
	date: string,
	opts: { fetchImpl?: typeof fetch; signal?: AbortSignal } = {}
): Promise<EarningsEvent[]> {
	if (market === "us") {
		return usEarnings(date, opts);
	}
	if (market === "a") {
		return aShareEarnings(date, opts);
	}
	// HK: best-effort, not covered in v1.
	return Promise.resolve([]);
}
