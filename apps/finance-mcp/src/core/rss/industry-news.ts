// Industry news via curated tier-1 RSS/Atom feeds (see sources.ts). Feeds
// for a sector are fetched in parallel; every failure degrades to [] so one
// slow or dead outlet never breaks the sector. Workers has no DOMParser, so
// parsing is a lightweight regex pass over <item>/<entry> blocks — good
// enough for title/link/date extraction from well-formed tier-1 feeds.
import { fetchWithRetry } from "../http";
import { INDUSTRY_SOURCES, type RssSource } from "./sources";

export interface IndustryNewsItem {
	link: string;
	source: string;
	time: string;
	title: string;
}

interface FetchOpts {
	fetchImpl?: typeof fetch;
	signal?: AbortSignal;
}

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;
const PER_SOURCE_LIMIT = 3;
const FEED_TIMEOUT_MS = 6000;
const FEED_RETRIES = 1;
const BROWSER_USER_AGENT =
	"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

const ITEM_BLOCK_RE = /<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/g;
const ENTRY_BLOCK_RE = /<entry(?:\s[^>]*)?>([\s\S]*?)<\/entry>/g;
const TITLE_RE = /<title[^>]*>([\s\S]*?)<\/title>/;
// RSS 2.0 link: `<link>https://…</link>`. Requires a closing tag, so it
// never matches Atom's self-closing `<link href="…"/>`.
const LINK_TEXT_RE = /<link[^>]*>([\s\S]*?)<\/link>/;
// Atom link: `<link href="…"/>` (first link is conventionally rel=alternate).
const LINK_HREF_RE = /<link[^>]*?href="([^"]*)"/;
const PUB_DATE_RE = /<pubDate[^>]*>([\s\S]*?)<\/pubDate>/;
const PUBLISHED_RE = /<published[^>]*>([\s\S]*?)<\/published>/;
const UPDATED_RE = /<updated[^>]*>([\s\S]*?)<\/updated>/;
const DATE_RES = [PUB_DATE_RE, PUBLISHED_RE, UPDATED_RE];
const CDATA_RE = /<!\[CDATA\[([\s\S]*?)\]\]>/g;
const ENTITY_LT_RE = /&lt;/g;
const ENTITY_GT_RE = /&gt;/g;
const ENTITY_QUOT_RE = /&quot;/g;
const ENTITY_APOS_RE = /&apos;/g;
const ENTITY_AMP_RE = /&amp;/g;
// Matches the normalized "YYYY-MM-DD HH:mm" form emitted by normalizeTime.
const NORMALIZED_TIME_RE = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2})$/;

// "2026-07-14T01:15:00.000Z".slice(0, 16) -> "2026-07-14T01:15"
const ISO_MINUTES_LEN = 16;

function clampLimit(limit: number): number {
	if (!Number.isFinite(limit) || limit <= 0) {
		return DEFAULT_LIMIT;
	}
	return Math.min(Math.floor(limit), MAX_LIMIT);
}

// Decodes the 5 predefined XML entities. &amp; must go last so encoded
// sequences like "&amp;lt;" are not double-decoded.
function decodeEntities(text: string): string {
	return text
		.replace(ENTITY_LT_RE, "<")
		.replace(ENTITY_GT_RE, ">")
		.replace(ENTITY_QUOT_RE, '"')
		.replace(ENTITY_APOS_RE, "'")
		.replace(ENTITY_AMP_RE, "&");
}

function cleanText(raw: string): string {
	return decodeEntities(raw.replace(CDATA_RE, "$1")).trim();
}

function firstMatch(block: string, re: RegExp): string {
	const match = re.exec(block);
	return match?.[1] ?? "";
}

function extractLink(block: string): string {
	const textLink = cleanText(firstMatch(block, LINK_TEXT_RE));
	if (textLink) {
		return textLink;
	}
	return cleanText(firstMatch(block, LINK_HREF_RE));
}

function extractRawTime(block: string): string {
	for (const re of DATE_RES) {
		const value = firstMatch(block, re).trim();
		if (value) {
			return value;
		}
	}
	return "";
}

// Parseable dates become "YYYY-MM-DD HH:mm" (UTC); anything Date.parse can't
// read is kept verbatim so the caller still sees the feed's original string.
function normalizeTime(raw: string): string {
	if (!raw) {
		return "";
	}
	const parsed = Date.parse(raw);
	if (Number.isNaN(parsed)) {
		return raw;
	}
	const iso = new Date(parsed).toISOString();
	return iso.slice(0, ISO_MINUTES_LEN).replace("T", " ");
}

function sortTs(time: string): number {
	const normalized = NORMALIZED_TIME_RE.exec(time);
	if (normalized) {
		return Date.parse(`${normalized[1]}T${normalized[2]}:00Z`);
	}
	const parsed = Date.parse(time);
	return Number.isNaN(parsed) ? Number.NEGATIVE_INFINITY : parsed;
}

// Newest first; items with unparseable times sink to the end (stable).
function compareNewest(a: IndustryNewsItem, b: IndustryNewsItem): number {
	const tsA = sortTs(a.time);
	const tsB = sortTs(b.time);
	if (tsA === tsB) {
		return 0;
	}
	return tsB - tsA;
}

function extractBlocks(xml: string): string[] {
	const items = [...xml.matchAll(ITEM_BLOCK_RE)].map((m) => m[1] ?? "");
	if (items.length > 0) {
		return items;
	}
	return [...xml.matchAll(ENTRY_BLOCK_RE)].map((m) => m[1] ?? "");
}

// Pure parse of one RSS 2.0 or Atom document. Exported for tests.
export function parseFeed(xml: string, source: string): IndustryNewsItem[] {
	const items: IndustryNewsItem[] = [];
	for (const block of extractBlocks(xml)) {
		const title = cleanText(firstMatch(block, TITLE_RE));
		const link = extractLink(block);
		if (!(title && link)) {
			continue;
		}
		items.push({
			link,
			source,
			time: normalizeTime(extractRawTime(block)),
			title,
		});
	}
	return items;
}

async function fetchFeed(
	source: RssSource,
	opts: FetchOpts
): Promise<IndustryNewsItem[]> {
	try {
		const res = await fetchWithRetry(
			source.url,
			{ headers: { "User-Agent": BROWSER_USER_AGENT } },
			{
				fetchImpl: opts.fetchImpl,
				retries: FEED_RETRIES,
				signal: opts.signal,
				timeoutMs: FEED_TIMEOUT_MS,
			}
		);
		if (!res.ok) {
			return [];
		}
		const items = parseFeed(await res.text(), source.name);
		return items.sort(compareNewest).slice(0, PER_SOURCE_LIMIT);
	} catch {
		return [];
	}
}

export async function getIndustryNews(
	sector: string,
	limit: number = DEFAULT_LIMIT,
	opts: FetchOpts = {}
): Promise<IndustryNewsItem[]> {
	const sources = INDUSTRY_SOURCES[sector];
	if (!sources || sources.length === 0) {
		return [];
	}
	const settled = await Promise.allSettled(
		sources.map((source) => fetchFeed(source, opts))
	);
	const merged: IndustryNewsItem[] = [];
	for (const result of settled) {
		if (result.status === "fulfilled") {
			merged.push(...result.value);
		}
	}
	return merged.sort(compareNewest).slice(0, clampLimit(limit));
}
