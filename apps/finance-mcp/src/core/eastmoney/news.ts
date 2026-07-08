// East Money news: 7x24 market flash news (getFastNewsList, plain JSON) and
// per-stock/keyword news search (search-api-web, raw JSON when cb= is empty,
// with a JSONP fallback in case the upstream still wraps the body).
import { fetchWithRetry } from "../http";
import type { NewsItem, StockNewsItem } from "../types";
import { parseJsonp } from "./jsonp";

const FAST_NEWS_URL =
	"https://np-listapi.eastmoney.com/comm/web/getFastNewsList";
const SEARCH_URL = "https://search-api-web.eastmoney.com/search/jsonp";

const MIN_LIMIT = 1;
const DEFAULT_NEWS_LIMIT = 20;
const MAX_NEWS_LIMIT = 100;
const DEFAULT_STOCK_NEWS_LIMIT = 10;
const MAX_STOCK_NEWS_LIMIT = 50;

const HTML_TAG_RE = /<[^>]*>/g;

function clampLimit(value: number, fallback: number, max: number): number {
	const n = Math.trunc(value) || fallback;
	return Math.min(Math.max(n, MIN_LIMIT), max);
}

function stripHtml(text: string): string {
	return text.replace(HTML_TAG_RE, "");
}

interface FastNewsRaw {
	code?: string;
	showTime?: string;
	stockList?: string[];
	summary?: string;
	title?: string;
}

interface FastNewsResponse {
	code?: string;
	data?: { fastNewsList?: FastNewsRaw[] } | null;
}

function toNewsItem(raw: FastNewsRaw): NewsItem | null {
	if (!raw.code) {
		return null;
	}
	return {
		id: raw.code,
		title: raw.title ?? "",
		summary: raw.summary ?? "",
		time: raw.showTime ?? "",
		related: raw.stockList ?? [],
	};
}

export async function getMarketNews(
	limit: number = DEFAULT_NEWS_LIMIT,
	opts: { fetchImpl?: typeof fetch; signal?: AbortSignal } = {}
): Promise<NewsItem[]> {
	const pageSize = clampLimit(limit, DEFAULT_NEWS_LIMIT, MAX_NEWS_LIMIT);
	const reqTrace = `${Date.now()}000`;
	const url =
		`${FAST_NEWS_URL}?client=web&biz=web_724&global=0&fastColumn=102` +
		`&sort=-1&pageSize=${pageSize}&sortEnd=&req_trace=${reqTrace}`;
	try {
		const res = await fetchWithRetry(
			url,
			{},
			{
				fetchImpl: opts.fetchImpl,
				signal: opts.signal,
			}
		);
		if (!res.ok) {
			return [];
		}
		const json = (await res.json()) as FastNewsResponse;
		const rows = json.data?.fastNewsList ?? [];
		return rows.map(toNewsItem).filter((r): r is NewsItem => r !== null);
	} catch {
		return [];
	}
}

interface CmsArticleRaw {
	content?: string;
	date?: string;
	mediaName?: string;
	title?: string;
	url?: string;
}

interface SearchResponse {
	code?: number;
	result?: { cmsArticleWebOld?: CmsArticleRaw[] } | null;
}

// `cb=` (empty) asks for raw JSON, but defensively fall back to the shared
// JSONP parser if the upstream still wraps the body in a callback.
function parseSearchBody<T>(body: string): T {
	try {
		return JSON.parse(body) as T;
	} catch {
		return parseJsonp<T>(body);
	}
}

function toStockNewsItem(raw: CmsArticleRaw): StockNewsItem | null {
	if (!raw.title) {
		return null;
	}
	return {
		date: raw.date ?? "",
		title: stripHtml(raw.title),
		snippet: stripHtml(raw.content ?? ""),
		source: raw.mediaName ?? "",
		url: raw.url ?? "",
	};
}

function searchParam(query: string, pageSize: number): string {
	return JSON.stringify({
		uid: "",
		keyword: query,
		type: ["cmsArticleWebOld"],
		client: "web",
		clientType: "web",
		clientVersion: "curr",
		param: {
			cmsArticleWebOld: {
				searchScope: "default",
				sort: "default",
				pageIndex: 1,
				pageSize,
				preTag: "",
				postTag: "",
			},
		},
	});
}

export async function getStockNews(
	query: string,
	limit: number = DEFAULT_STOCK_NEWS_LIMIT,
	opts: { fetchImpl?: typeof fetch; signal?: AbortSignal } = {}
): Promise<StockNewsItem[]> {
	const pageSize = clampLimit(
		limit,
		DEFAULT_STOCK_NEWS_LIMIT,
		MAX_STOCK_NEWS_LIMIT
	);
	const param = encodeURIComponent(searchParam(query, pageSize));
	const url = `${SEARCH_URL}?cb=&param=${param}`;
	try {
		const res = await fetchWithRetry(
			url,
			{},
			{
				fetchImpl: opts.fetchImpl,
				signal: opts.signal,
			}
		);
		if (!res.ok) {
			return [];
		}
		const text = await res.text();
		const json = parseSearchBody<SearchResponse>(text);
		const rows = json.result?.cmsArticleWebOld ?? [];
		return rows
			.map(toStockNewsItem)
			.filter((r): r is StockNewsItem => r !== null);
	} catch {
		return [];
	}
}
