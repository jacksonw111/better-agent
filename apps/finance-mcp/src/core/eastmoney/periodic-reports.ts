import { parseSymbol } from "../symbol";
import type { Report, ReportType } from "../types";
import { parseJsonp } from "./jsonp";

interface RawAnn {
	art_code?: string;
	columns?: { column_name?: string }[];
	notice_date?: string;
	title_ch?: string;
}

// Exact column_name values that identify the four full Chinese periodic reports.
// "年度报告摘要", "年度报告全文(英文)", and all non-report names are excluded by
// not being present in this map.
const NAME_TO_TYPE = new Map<string, ReportType>([
	["年度报告全文", "annual"],
	["半年度报告全文", "h1"],
	["一季度报告全文", "q1"],
	["三季度报告全文", "q3"],
]);

const MAX_PAGES = 5;
const PAGE_SIZE = 100;

function reportTypeFromColumns(
	columns: { column_name?: string }[]
): ReportType | null {
	for (const col of columns) {
		const t = NAME_TO_TYPE.get(col.column_name ?? "");
		if (t !== undefined) {
			return t;
		}
	}
	return null;
}

function toReport(r: RawAnn, reportType: ReportType): Report {
	const noticeDate = (r.notice_date ?? "").slice(0, 10);
	const title = r.title_ch ?? "";
	const upstream = `https://pdf.dfcfw.com/pdf/H2_${r.art_code}_1.pdf`;
	return {
		artCode: r.art_code as string,
		title,
		reportType,
		fiscalPeriod: title,
		noticeDate,
		pdfUrl: `/pdf?url=${encodeURIComponent(upstream)}`,
	};
}

async function fetchAnnPage(
	code: string,
	pageIndex: number,
	doFetch: typeof fetch,
	signal: AbortSignal | undefined
): Promise<RawAnn[]> {
	const url =
		"https://np-anotice-stock.eastmoney.com/api/security/ann" +
		`?cb=jsonp&sr=-1&page_size=${PAGE_SIZE}&page_index=${pageIndex}` +
		`&ann_type=A&client_source=web&stock_list=${code}`;
	const res = await doFetch(url, {
		headers: { Referer: "https://data.eastmoney.com/" },
		signal,
	});
	const data = parseJsonp<{ data?: { list?: RawAnn[] } }>(await res.text());
	return data.data?.list ?? [];
}

// Process one page: collect matching in-window reports and return the oldest
// date seen on the page (used to decide whether to stop paging).
function processPage(
	list: RawAnn[],
	cutoffDate: string,
	collected: Report[]
): string {
	let oldestOnPage = "";
	for (const r of list) {
		const date = (r.notice_date ?? "").slice(0, 10);
		if (!oldestOnPage || date < oldestOnPage) {
			oldestOnPage = date;
		}
		if (!r.art_code) {
			continue;
		}
		const reportType = reportTypeFromColumns(r.columns ?? []);
		if (reportType === null) {
			continue;
		}
		const report = toReport(r, reportType);
		if (report.noticeDate && report.noticeDate >= cutoffDate) {
			collected.push(report);
		}
	}
	return oldestOnPage;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const DAYS_PER_YEAR = 365;

export async function listReports(
	symbol: string,
	years: number,
	opts: {
		now?: number;
		fetchImpl?: typeof fetch;
		signal?: AbortSignal;
	} = {}
): Promise<Report[]> {
	const doFetch = opts.fetchImpl ?? fetch;
	const { code } = parseSymbol(symbol);
	const cutoff = (opts.now ?? Date.now()) - years * DAYS_PER_YEAR * MS_PER_DAY;
	const cutoffDate = new Date(cutoff).toISOString().slice(0, 10);
	const collected: Report[] = [];

	try {
		for (let page = 1; page <= MAX_PAGES; page++) {
			const list = await fetchAnnPage(code, page, doFetch, opts.signal);
			if (list.length === 0) {
				break;
			}
			const oldestOnPage = processPage(list, cutoffDate, collected);
			// Stop when partial page (server has no more), or window fully covered
			if (list.length < PAGE_SIZE || oldestOnPage < cutoffDate) {
				break;
			}
		}
	} catch {
		return [];
	}

	return collected.sort((a, b) => b.noticeDate.localeCompare(a.noticeDate));
}
