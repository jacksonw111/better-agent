// 东财个股热门概念命中 — which market concepts a stock is currently being
// traded under, ranked by hit heat. VERIFIED live during research. Same
// emappdata app-data POST style as cn-hot.ts.
import { fetchWithRetry } from "../http";

const HOT_CONCEPT_URL =
	"https://emappdata.eastmoney.com/stockrank/getHotStockRankList";
const APP_ID = "appId01";
const GLOBAL_ID = "786e4c21-70dc-435a-93bb-38";
const SH_LEADING_DIGIT = "6";
const MARKET_SUFFIX_RE = /\.(SH|SZ)$/i;
const MARKET_PREFIX_RE = /^(SH|SZ)/i;

interface FetchOpts {
	fetchImpl?: typeof fetch;
	signal?: AbortSignal;
}

interface RawConceptRow {
	conceptId?: string | null;
	conceptName?: string | null;
	hitCount?: number | null;
}

export interface HotConceptRow {
	boardCode: string;
	concept: string;
	hits: number;
}

// Accepts "600519", "600519.SH", or "SH600519" and yields the bare 6-digit
// code the endpoint expects (prefix is re-derived from the leading digit).
export function toBareCode(code: string): string {
	return code
		.trim()
		.replace(MARKET_SUFFIX_RE, "")
		.replace(MARKET_PREFIX_RE, "");
}

export async function getHotConcepts(
	code: string,
	opts: FetchOpts = {}
): Promise<HotConceptRow[]> {
	const bare = toBareCode(code);
	const prefix = bare.startsWith(SH_LEADING_DIGIT) ? "SH" : "SZ";
	try {
		const res = await fetchWithRetry(
			HOT_CONCEPT_URL,
			{
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					appId: APP_ID,
					globalId: GLOBAL_ID,
					srcSecurityCode: `${prefix}${bare}`,
				}),
			},
			{ fetchImpl: opts.fetchImpl, signal: opts.signal }
		);
		if (!res.ok) {
			return [];
		}
		const json = (await res.json()) as { data?: RawConceptRow[] | null };
		return (json.data ?? []).map((row) => ({
			concept: row.conceptName ?? "",
			boardCode: row.conceptId ?? "",
			hits: row.hitCount ?? 0,
		}));
	} catch {
		return [];
	}
}
