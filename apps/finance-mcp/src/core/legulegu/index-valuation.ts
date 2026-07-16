// A-share index valuation percentile (PE/PB + 历史分位) via legulegu (乐咕乐股),
// the same source akshare's stock_index_pe_lg/pb uses. VERIFIED live during
// research. Percentiles arrive PRE-COMPUTED (ttmPeQuantile / pbQuantile), so we
// just surface the latest settlement row + a valuation verdict.
//
// Access needs a small CSRF dance: GET a legulegu HTML page to grab its
// `<meta name="_csrf">` token + session cookies, then call the JSON API with a
// `token = md5(server-side Beijing date)` query param plus the CSRF header and
// cookies. Every step degrades to null rather than throwing.
import { md5Hex } from "../cls/md5";
import { fetchWithRetry } from "../http";

const PE_URL = "https://legulegu.com/api/stockdata/index-basic-pe";
const PB_URL = "https://legulegu.com/api/stockdata/index-basic-pb";
const CSRF_PAGE = "https://legulegu.com/stockdata/sz50-ttm-lyr";
const UA =
	"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";
const BEIJING_OFFSET_MS = 8 * 60 * 60 * 1000;
const PCT = 100;
const PCT_DECIMALS = 1;

// legulegu index codes for the supported broad-based indices. Keys are the
// canonical Chinese names; resolveIndexCode also accepts a raw code or a few
// common aliases.
export const INDEX_CODE_MAP: Record<string, string> = {
	上证50: "000016.SH",
	沪深300: "000300.SH",
	上证380: "000009.SH",
	创业板50: "399673.SZ",
	中证500: "000905.SH",
	上证180: "000010.SH",
	深证红利: "399324.SZ",
	深证100: "399330.SZ",
	中证1000: "000852.SH",
	上证红利: "000015.SH",
	中证100: "000903.SH",
	中证800: "000906.SH",
};

const ALIAS: Record<string, string> = {
	hs300: "沪深300",
	"000300": "沪深300",
	sz50: "上证50",
	"000016": "上证50",
	zz500: "中证500",
	"000905": "中证500",
	zz1000: "中证1000",
	"000852": "中证1000",
	cyb50: "创业板50",
	zz800: "中证800",
};

export function resolveIndexCode(
	symbol: string
): { name: string; code: string } | null {
	const raw = symbol.trim();
	const direct = INDEX_CODE_MAP[raw];
	if (direct) {
		return { name: raw, code: direct };
	}
	const aliased = ALIAS[raw.toLowerCase()];
	const aliasedCode = aliased ? INDEX_CODE_MAP[aliased] : undefined;
	if (aliased && aliasedCode) {
		return { name: aliased, code: aliasedCode };
	}
	// Accept a raw legulegu code (e.g. "000300.SH") by reverse lookup.
	for (const [name, code] of Object.entries(INDEX_CODE_MAP)) {
		if (code === raw || code.startsWith(`${raw}.`)) {
			return { name, code };
		}
	}
	return null;
}

interface PeRow {
	date?: string;
	lyrPe?: number;
	lyrPeQuantile?: number;
	ttmPe?: number;
	ttmPeQuantile?: number;
}
interface PbRow {
	date?: string;
	pb?: number;
	pbQuantile?: number;
}

export interface IndexValuation {
	date: string;
	index: string;
	indexCode: string;
	pb: number | null;
	pbPercentile: number | null;
	/** 静态市盈率 (LYR). */
	peLyr: number | null;
	peLyrPercentile: number | null;
	/** 动态市盈率 (TTM). */
	peTtm: number | null;
	/** TTM PE 历史分位 %, 0–100. */
	peTtmPercentile: number | null;
	/** 估值研判, 由 TTM PE 分位得出. */
	verdict: string;
}

interface Opts {
	fetchImpl?: typeof fetch;
	signal?: AbortSignal;
}

function pct(quantile: number | undefined): number | null {
	if (typeof quantile !== "number" || !Number.isFinite(quantile)) {
		return null;
	}
	return Math.round(quantile * PCT * 10 ** PCT_DECIMALS) / 10 ** PCT_DECIMALS;
}

function orNull(value: number | undefined): number | null {
	return typeof value === "number" && Number.isFinite(value) ? value : null;
}

// Valuation verdict from the TTM PE percentile (0–100).
export function verdictFor(percentile: number | null): string {
	if (percentile === null) {
		return "未知";
	}
	const LOW = 20;
	const BELOW = 40;
	const FAIR = 60;
	const HIGH = 80;
	if (percentile < LOW) {
		return "低估";
	}
	if (percentile < BELOW) {
		return "偏低";
	}
	if (percentile < FAIR) {
		return "合理";
	}
	if (percentile < HIGH) {
		return "偏高";
	}
	return "高估";
}

// Pure assembly of the latest PE + PB rows into one valuation snapshot.
export function buildValuation(
	name: string,
	code: string,
	peRows: PeRow[],
	pbRows: PbRow[]
): IndexValuation | null {
	if (peRows.length === 0 && pbRows.length === 0) {
		return null;
	}
	// Narrow to non-optional locals so the mapping below has no `?.` branches
	// (keeps cyclomatic complexity under the lint gate).
	const pe: PeRow = peRows.at(-1) ?? {};
	const pb: PbRow = pbRows.at(-1) ?? {};
	const peTtmPercentile = pct(pe.ttmPeQuantile);
	return {
		index: name,
		indexCode: code,
		date: pe.date ?? pb.date ?? "",
		peTtm: orNull(pe.ttmPe),
		peTtmPercentile,
		peLyr: orNull(pe.lyrPe),
		peLyrPercentile: pct(pe.lyrPeQuantile),
		pb: orNull(pb.pb),
		pbPercentile: pct(pb.pbQuantile),
		verdict: verdictFor(peTtmPercentile),
	};
}

// Beijing (UTC+8) calendar date, `YYYY-MM-DD`, from a server Date header (or
// now). legulegu derives its daily token from its own local (Beijing) date.
function beijingDate(dateHeader: string | null): string {
	const ms = dateHeader ? Date.parse(dateHeader) : Date.now();
	const base = Number.isFinite(ms) ? ms : Date.now();
	return new Date(base + BEIJING_OFFSET_MS).toISOString().slice(0, 10);
}

const CSRF_RE = /name="_csrf"\s+content="([^"]+)"/;
const CSRF_RE_ALT = /content="([^"]+)"\s+name="_csrf"/;

function parseCsrf(html: string): string | null {
	return (html.match(CSRF_RE) ?? html.match(CSRF_RE_ALT))?.[1] ?? null;
}

function cookieHeader(res: Response): string {
	const getter = (res.headers as Headers & { getSetCookie?: () => string[] })
		.getSetCookie;
	const raw = getter ? getter.call(res.headers) : [];
	const pairs = (raw.length ? raw : [res.headers.get("set-cookie") ?? ""])
		.filter(Boolean)
		.map((c) => c.split(";")[0]);
	return pairs.join("; ");
}

async function fetchRows(
	url: string,
	code: string,
	token: string,
	csrf: string,
	cookie: string,
	opts: Opts
): Promise<unknown[]> {
	const res = await fetchWithRetry(
		`${url}?token=${token}&indexCode=${encodeURIComponent(code)}`,
		{
			headers: {
				"User-Agent": UA,
				"X-CSRF-Token": csrf,
				Cookie: cookie,
				Referer: CSRF_PAGE,
			},
		},
		{ fetchImpl: opts.fetchImpl, signal: opts.signal }
	);
	if (!res.ok) {
		return [];
	}
	const json = (await res.json()) as { data?: unknown[] };
	return json.data ?? [];
}

export async function getIndexValuation(
	symbol: string,
	opts: Opts = {}
): Promise<IndexValuation | null> {
	const resolved = resolveIndexCode(symbol);
	if (!resolved) {
		return null;
	}
	try {
		const page = await fetchWithRetry(
			CSRF_PAGE,
			{ headers: { "User-Agent": UA } },
			{ fetchImpl: opts.fetchImpl, signal: opts.signal }
		);
		if (!page.ok) {
			return null;
		}
		const html = await page.text();
		const csrf = parseCsrf(html);
		if (!csrf) {
			return null;
		}
		const cookie = cookieHeader(page);
		const token = md5Hex(beijingDate(page.headers.get("date")));
		const [peRows, pbRows] = await Promise.all([
			fetchRows(PE_URL, resolved.code, token, csrf, cookie, opts),
			fetchRows(PB_URL, resolved.code, token, csrf, cookie, opts),
		]);
		return buildValuation(
			resolved.name,
			resolved.code,
			peRows as PeRow[],
			pbRows as PbRow[]
		);
	} catch {
		return null;
	}
}
