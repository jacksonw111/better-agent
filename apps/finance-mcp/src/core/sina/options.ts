// 新浪 ETF 期权 (Sina ETF options): contract listing + T-quote + greeks/IV.
// hq.sinajs.cn responses are GBK-encoded `var hq_str_X="a,b,c,...";` blobs
// and require the stock.finance.sina.com.cn Referer (403 otherwise). Greeks
// and IV are pre-computed upstream — no local BSM needed.
import { fetchWithRetry } from "../http";

const HQ_URL = "https://hq.sinajs.cn/list=";
const MONTHS_URL =
	"https://stock.finance.sina.com.cn/futures/api/openapi.php/StockOptionService.getStockName?exchange=null&cate=";
const SINA_REFERER = "https://stock.finance.sina.com.cn/";
const CONTRACT_PREFIX = "CON_OP_";
const YYMM_START = 2;

const UNDERLYING_CATE: Record<string, string> = {
	"510050": "50ETF",
	"510300": "300ETF",
	"510500": "500ETF",
	"588000": "科创50ETF",
};
const DEFAULT_CATE = "50ETF";

// T-quote field positions (per sina_option_tquote, verified live).
const TQ_MIN_FIELDS = 43;
const TQ_BID_VOL = 0;
const TQ_BID = 1;
const TQ_LAST = 2;
const TQ_ASK = 3;
const TQ_ASK_VOL = 4;
const TQ_OPEN_INTEREST = 5;
const TQ_PCT = 6;
const TQ_STRIKE = 7;
const TQ_PREV_CLOSE = 8;
const TQ_OPEN = 9;
const TQ_LIMIT_UP = 10;
const TQ_LIMIT_DOWN = 11;
const TQ_NAME = 37;
const TQ_AMPLITUDE = 38;
const TQ_HIGH = 39;
const TQ_LOW = 40;
const TQ_VOLUME = 41;
const TQ_AMOUNT = 42;

// Greeks field positions AFTER re-alignment (see parseGreeksFields).
const GK_MIN_RAW_FIELDS = 16;
const GK_SKIP_FROM = 4;
const GK_NAME = 0;
const GK_VOLUME = 1;
const GK_DELTA = 2;
const GK_GAMMA = 3;
const GK_THETA = 4;
const GK_VEGA = 5;
const GK_IV = 6;
const GK_HIGH = 7;
const GK_LOW = 8;
const GK_TRADE_CODE = 9;
const GK_STRIKE = 10;
const GK_LAST = 11;
const GK_THEORY = 12;

interface FetchOpts {
	fetchImpl?: typeof fetch;
	signal?: AbortSignal;
}

export interface OptionTquote {
	amount: number;
	amplitude: number;
	ask: number;
	askVol: number;
	bid: number;
	bidVol: number;
	high: number;
	last: number;
	limitDown: number;
	limitUp: number;
	low: number;
	name: string;
	open: number;
	openInterest: number;
	pct: number;
	prevClose: number;
	strike: number;
	volume: number;
}

export interface OptionGreeks {
	delta: number;
	gamma: number;
	high: number;
	iv: number;
	last: number;
	low: number;
	name: string;
	strike: number;
	theory: number;
	theta: number;
	tradeCode: string;
	vega: number;
	volume: number;
}

export interface OptionQuoteDetail extends OptionTquote {
	delta: number;
	gamma: number;
	iv: number;
	theory: number;
	theta: number;
	tradeCode: string;
	vega: number;
}

function num(fields: string[], i: number): number {
	const n = Number(fields[i]);
	return Number.isFinite(n) ? n : 0;
}

// Pure parse of a CON_OP_ T-quote field array. Null when too short (empty
// or malformed contract).
export function parseTquoteFields(fields: string[]): OptionTquote | null {
	if (fields.length < TQ_MIN_FIELDS) {
		return null;
	}
	return {
		bidVol: num(fields, TQ_BID_VOL),
		bid: num(fields, TQ_BID),
		last: num(fields, TQ_LAST),
		ask: num(fields, TQ_ASK),
		askVol: num(fields, TQ_ASK_VOL),
		openInterest: num(fields, TQ_OPEN_INTEREST),
		pct: num(fields, TQ_PCT),
		strike: num(fields, TQ_STRIKE),
		prevClose: num(fields, TQ_PREV_CLOSE),
		open: num(fields, TQ_OPEN),
		limitUp: num(fields, TQ_LIMIT_UP),
		limitDown: num(fields, TQ_LIMIT_DOWN),
		name: fields[TQ_NAME] ?? "",
		amplitude: num(fields, TQ_AMPLITUDE),
		high: num(fields, TQ_HIGH),
		low: num(fields, TQ_LOW),
		volume: num(fields, TQ_VOLUME),
		amount: num(fields, TQ_AMOUNT),
	};
}

// Pure parse of a CON_SO_ greeks field array. CRITICAL: raw[1..3] are three
// empty strings — they MUST be skipped ([raw[0], ...raw.slice(4)]) or every
// field (delta/IV/...) misaligns. `iv` stays a decimal (0.17 = 17%).
export function parseGreeksFields(raw: string[]): OptionGreeks | null {
	if (raw.length < GK_MIN_RAW_FIELDS) {
		return null;
	}
	const v = [raw[0] ?? "", ...raw.slice(GK_SKIP_FROM)];
	return {
		name: v[GK_NAME] ?? "",
		volume: num(v, GK_VOLUME),
		delta: num(v, GK_DELTA),
		gamma: num(v, GK_GAMMA),
		theta: num(v, GK_THETA),
		vega: num(v, GK_VEGA),
		iv: num(v, GK_IV),
		high: num(v, GK_HIGH),
		low: num(v, GK_LOW),
		tradeCode: v[GK_TRADE_CODE] ?? "",
		strike: num(v, GK_STRIKE),
		last: num(v, GK_LAST),
		theory: num(v, GK_THEORY),
	};
}

// GET hq.sinajs.cn/list={param}, GBK-decoded, unwrapped to the comma-split
// field array. Degrades to [].
async function sinaList(param: string, opts: FetchOpts): Promise<string[]> {
	try {
		const res = await fetchWithRetry(
			`${HQ_URL}${param}`,
			{ headers: { Referer: SINA_REFERER } },
			{ fetchImpl: opts.fetchImpl, signal: opts.signal }
		);
		if (!res.ok) {
			return [];
		}
		const text = new TextDecoder("gbk").decode(await res.arrayBuffer());
		if (!text.includes('"')) {
			return [];
		}
		return (text.split('"')[1] ?? "").split(",");
	} catch {
		return [];
	}
}

async function fetchMonths(cate: string, opts: FetchOpts): Promise<string[]> {
	try {
		const res = await fetchWithRetry(
			`${MONTHS_URL}${encodeURIComponent(cate)}`,
			{ headers: { Referer: SINA_REFERER } },
			{ fetchImpl: opts.fetchImpl, signal: opts.signal }
		);
		if (!res.ok) {
			return [];
		}
		const json = (await res.json()) as {
			result?: { data?: { contractMonth?: string[] | null } | null } | null;
		};
		const months = json.result?.data?.contractMonth ?? [];
		// First entry duplicates the near month — drop it; "2026-07" -> "2607".
		return months.slice(1).map((m) => m.replace(/-/g, "").slice(YYMM_START));
	} catch {
		return [];
	}
}

export async function getOptionContracts(
	underlying: string,
	kind: "call" | "put",
	opts: FetchOpts = {}
): Promise<Record<string, string[]>> {
	const cate = UNDERLYING_CATE[underlying] ?? DEFAULT_CATE;
	const months = await fetchMonths(cate, opts);
	const flag = kind === "call" ? "OP_UP_" : "OP_DOWN_";
	const out: Record<string, string[]> = {};
	for (const month of months) {
		const entries = await sinaList(`${flag}${underlying}${month}`, opts);
		const codes = entries
			.filter((c) => c.startsWith(CONTRACT_PREFIX))
			.map((c) => c.slice(CONTRACT_PREFIX.length));
		if (codes.length > 0) {
			out[month] = codes;
		}
	}
	return out;
}

// When the T-quote leg is missing, greeks still carry name/strike/last/
// high/low/volume — use them so the merged shape stays useful.
function tquoteFromGreeks(greeks: OptionGreeks): OptionTquote {
	return {
		bidVol: 0,
		bid: 0,
		last: greeks.last,
		ask: 0,
		askVol: 0,
		openInterest: 0,
		pct: 0,
		strike: greeks.strike,
		prevClose: 0,
		open: 0,
		limitUp: 0,
		limitDown: 0,
		name: greeks.name,
		amplitude: 0,
		high: greeks.high,
		low: greeks.low,
		volume: greeks.volume,
		amount: 0,
	};
}

function greeksOverlay(greeks: OptionGreeks | null) {
	if (!greeks) {
		return {
			delta: 0,
			gamma: 0,
			theta: 0,
			vega: 0,
			iv: 0,
			theory: 0,
			tradeCode: "",
		};
	}
	return {
		delta: greeks.delta,
		gamma: greeks.gamma,
		theta: greeks.theta,
		vega: greeks.vega,
		iv: greeks.iv,
		theory: greeks.theory,
		tradeCode: greeks.tradeCode,
	};
}

export async function getOptionQuote(
	code: string,
	opts: FetchOpts = {}
): Promise<OptionQuoteDetail | null> {
	const [tquoteRaw, greeksRaw] = await Promise.all([
		sinaList(`CON_OP_${code}`, opts),
		sinaList(`CON_SO_${code}`, opts),
	]);
	const tquote = parseTquoteFields(tquoteRaw);
	const greeks = parseGreeksFields(greeksRaw);
	const base = tquote ?? (greeks ? tquoteFromGreeks(greeks) : null);
	if (!base) {
		return null;
	}
	return { ...base, ...greeksOverlay(greeks) };
}
