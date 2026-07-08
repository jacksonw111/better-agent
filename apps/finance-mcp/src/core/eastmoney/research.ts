// East Money analyst research reports via reportapi.eastmoney.com (JSONP).
// PDF URL pattern: H3_${infoCode}_1.pdf (H3 = research reports; H2 = periodic
// reports, see periodic-reports.ts). Proxied through /pdf like periodic
// reports so the client never talks to pdf.dfcfw.com directly.
import { fetchWithRetry } from "../http";
import { parseSymbol } from "../symbol";
import type { ResearchReport } from "../types";
import { parseJsonp } from "./jsonp";

interface RawReport {
	infoCode?: string;
	orgSName?: string;
	predictNextTwoYearEps?: string;
	predictNextTwoYearPe?: string;
	predictNextYearEps?: string;
	predictNextYearPe?: string;
	predictThisYearEps?: string;
	predictThisYearPe?: string;
	publishDate?: string;
	title?: string;
}

interface RawResearchResponse {
	data?: RawReport[];
}

export interface ResearchOpts {
	fetchImpl?: typeof fetch;
	now?: number;
	signal?: AbortSignal;
	years?: number;
}

const DEFAULT_RESEARCH_YEARS = 2;
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const DAYS_PER_YEAR = 365;
const DATE_LENGTH = 10;

function parseEpsOrPe(s: string | undefined): number | null {
	if (!s || s.trim() === "") {
		return null;
	}
	const n = Number.parseFloat(s);
	return Number.isFinite(n) ? n : null;
}

function formatDate(ms: number): string {
	return new Date(ms).toISOString().slice(0, DATE_LENGTH);
}

function buildPdfUrl(infoCode: string): string {
	const upstream = `https://pdf.dfcfw.com/pdf/H3_${infoCode}_1.pdf`;
	return `/pdf?url=${encodeURIComponent(upstream)}`;
}

function toResearchReport(r: RawReport): ResearchReport | null {
	const infoCode = r.infoCode?.trim();
	if (!infoCode) {
		return null;
	}
	return {
		title: r.title ?? "",
		org: r.orgSName ?? "",
		date: (r.publishDate ?? "").slice(0, DATE_LENGTH),
		pdfUrl: buildPdfUrl(infoCode),
		epsY0: parseEpsOrPe(r.predictThisYearEps),
		epsY1: parseEpsOrPe(r.predictNextYearEps),
		epsY2: parseEpsOrPe(r.predictNextTwoYearEps),
		peY0: parseEpsOrPe(r.predictThisYearPe),
		peY1: parseEpsOrPe(r.predictNextYearPe),
		peY2: parseEpsOrPe(r.predictNextTwoYearPe),
	};
}

// Fetches raw research reports for a 6-digit A-share code. Exported so
// forecast.ts can reuse it without re-deriving the code from a symbol.
export async function fetchResearchReportsForCode(
	code: string,
	opts: ResearchOpts = {}
): Promise<ResearchReport[]> {
	const years = opts.years ?? DEFAULT_RESEARCH_YEARS;
	const nowMs = opts.now ?? Date.now();
	const cutoffMs = nowMs - years * DAYS_PER_YEAR * MS_PER_DAY;
	const beginTime = formatDate(cutoffMs);
	const endTime = formatDate(nowMs);
	const url =
		"https://reportapi.eastmoney.com/report/list" +
		`?cb=jsonp&beginTime=${beginTime}&endTime=${endTime}` +
		`&pageNo=1&pageSize=30&qType=0&code=${code}`;
	try {
		const res = await fetchWithRetry(
			url,
			{ headers: { Referer: "https://data.eastmoney.com/" } },
			{ fetchImpl: opts.fetchImpl, signal: opts.signal }
		);
		const text = await res.text();
		const parsed = parseJsonp<RawResearchResponse>(text);
		const rows = parsed.data ?? [];
		const reports: ResearchReport[] = [];
		for (const r of rows) {
			const report = toResearchReport(r);
			if (report !== null) {
				reports.push(report);
			}
		}
		return reports.sort((a, b) => b.date.localeCompare(a.date));
	} catch {
		return [];
	}
}

// research is an A-share-only source: for other markets we degrade to []
// rather than throw (unlike secucode()-based fundamentals connectors),
// since there's simply no equivalent EastMoney research feed to fall back to.
export function getStockResearch(
	symbol: string,
	opts: ResearchOpts = {}
): Promise<ResearchReport[]> {
	const { market, code } = parseSymbol(symbol);
	if (market !== "a") {
		return Promise.resolve([]);
	}
	return fetchResearchReportsForCode(code, opts);
}
