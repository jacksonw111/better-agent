// 巨潮公告 (cninfo announcement full-text search) with an EastMoney backup
// feed. Strategy: query cninfo with the cheap hardcoded orgId first; if that
// yields zero rows, lazily fetch the ~1MB official orgId map and retry once
// with the real orgId; if cninfo still fails or is empty, fall back to
// EastMoney's np-anotice feed (titles + PDF links only).
import { fetchWithRetry } from "../http";
import { fallbackOrgId, fetchOrgId } from "./org-id";

// cninfo silently returns an empty body without a browser User-Agent.
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36";
const CNINFO_QUERY_URL = "https://www.cninfo.com.cn/new/hisAnnouncement/query";
const CNINFO_DETAIL_URL =
	"https://www.cninfo.com.cn/new/disclosure/detail?annoId=";
const CNINFO_STATIC_HOST = "http://static.cninfo.com.cn/";
const EM_BACKUP_URL = "https://np-anotice-stock.eastmoney.com/api/security/ann";
const EM_PDF_HOST = "https://pdf.dfcfw.com/pdf/";
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;
const HOURS_UTC8 = 8;
const MS_PER_HOUR = 3_600_000;
const DATE_LEN = 10;

export interface AnnouncementRow {
	date: string;
	pdf: string;
	title: string;
	type: string;
	url: string;
}

interface FetchOpts {
	fetchImpl?: typeof fetch;
	signal?: AbortSignal;
}

interface CninfoAnnouncement {
	adjunctUrl?: string | null;
	announcementId?: string | null;
	announcementTime?: number | string | null;
	announcementTitle?: string | null;
	announcementTypeName?: string | null;
}

interface EmBackupRow {
	art_code?: string | null;
	notice_date?: string | null;
	title?: string | null;
}

function clampLimit(limit: number): number {
	if (!Number.isFinite(limit) || limit <= 0) {
		return DEFAULT_LIMIT;
	}
	return Math.min(Math.floor(limit), MAX_LIMIT);
}

// announcementTime is unix ms — shift to UTC+8 manually, then read the UTC
// calendar date (Workers has no CN timezone database).
function toUtc8Date(ts: number | string | null | undefined): string {
	if (typeof ts === "number" && Number.isFinite(ts)) {
		const shifted = new Date(ts + HOURS_UTC8 * MS_PER_HOUR);
		return shifted.toISOString().slice(0, DATE_LEN);
	}
	return ts ? String(ts).slice(0, DATE_LEN) : "";
}

function toRow(item: CninfoAnnouncement): AnnouncementRow {
	return {
		title: item.announcementTitle ?? "",
		type: item.announcementTypeName ?? "",
		date: toUtc8Date(item.announcementTime),
		url: `${CNINFO_DETAIL_URL}${item.announcementId ?? ""}`,
		pdf: item.adjunctUrl ? `${CNINFO_STATIC_HOST}${item.adjunctUrl}` : "",
	};
}

async function queryCninfo(
	code: string,
	orgId: string,
	limit: number,
	searchKey: string,
	opts: FetchOpts
): Promise<AnnouncementRow[]> {
	const body = new URLSearchParams({
		stock: `${code},${orgId}`,
		tabName: "fulltext",
		pageSize: String(limit),
		pageNum: "1",
		column: "",
		category: "",
		plate: "",
		seDate: "",
		searchkey: searchKey,
		secid: "",
		sortName: "",
		sortType: "",
		isHLtitle: "true",
	});
	try {
		const res = await fetchWithRetry(
			CNINFO_QUERY_URL,
			{
				method: "POST",
				headers: {
					"Content-Type": "application/x-www-form-urlencoded",
					Referer: "https://www.cninfo.com.cn/new/disclosure",
					Origin: "https://www.cninfo.com.cn",
					"User-Agent": UA,
				},
				body: body.toString(),
			},
			{ fetchImpl: opts.fetchImpl, signal: opts.signal }
		);
		if (!res.ok) {
			return [];
		}
		const json = (await res.json()) as {
			announcements?: CninfoAnnouncement[] | null;
		};
		return (json.announcements ?? []).map(toRow);
	} catch {
		return [];
	}
}

async function fetchBackup(
	code: string,
	limit: number,
	opts: FetchOpts
): Promise<AnnouncementRow[]> {
	const url =
		`${EM_BACKUP_URL}?sr=-1&page_size=${limit}&page_index=1&ann_type=A` +
		`&client_source=web&stock_list=${code}&f_node=0&s_node=0`;
	try {
		const res = await fetchWithRetry(
			url,
			{},
			{ fetchImpl: opts.fetchImpl, signal: opts.signal }
		);
		if (!res.ok) {
			return [];
		}
		const json = (await res.json()) as {
			data?: { list?: EmBackupRow[] | null } | null;
		};
		return (json.data?.list ?? []).map((item) => ({
			title: item.title ?? "",
			type: "",
			date: (item.notice_date ?? "").slice(0, DATE_LEN),
			url: "",
			pdf: item.art_code ? `${EM_PDF_HOST}H2_${item.art_code}_1.pdf` : "",
		}));
	} catch {
		return [];
	}
}

export async function getAnnouncements(
	code: string,
	limit: number = DEFAULT_LIMIT,
	searchKey = "",
	opts: FetchOpts = {}
): Promise<AnnouncementRow[]> {
	const cappedLimit = clampLimit(limit);
	const guessedOrgId = fallbackOrgId(code);
	let rows = await queryCninfo(
		code,
		guessedOrgId,
		cappedLimit,
		searchKey,
		opts
	);
	if (rows.length === 0) {
		// Zero rows usually means the hardcoded orgId guess was wrong (#19) —
		// resolve the real one from the official map and retry exactly once.
		const realOrgId = await fetchOrgId(code, opts);
		if (realOrgId && realOrgId !== guessedOrgId) {
			rows = await queryCninfo(code, realOrgId, cappedLimit, searchKey, opts);
		}
	}
	if (rows.length > 0) {
		return rows;
	}
	return fetchBackup(code, cappedLimit, opts);
}
