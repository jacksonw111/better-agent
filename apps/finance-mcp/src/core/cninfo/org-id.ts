// 巨潮 orgId resolution. cninfo's real orgIds are NOT uniformly derivable
// from the stock code (e.g. 601318→9900002221, 688017→9900041602) — only
// older listings follow the gssh0/gssz0/gsbj0 pattern. The official map
// (szse_stock.json, ~1MB) is fetched lazily only when the cheap fallback
// format fails to return announcements.
import { fetchWithRetry } from "../http";

const ORG_MAP_URL = "http://www.cninfo.com.cn/new/data/szse_stock.json";

interface FetchOpts {
	fetchImpl?: typeof fetch;
	signal?: AbortSignal;
}

interface StockListEntry {
	code?: string | null;
	orgId?: string | null;
}

// Legacy hardcoded format — correct for a subset of older listings, used as
// the first (network-free) attempt.
export function fallbackOrgId(code: string): string {
	if (code.startsWith("6")) {
		return `gssh0${code}`;
	}
	if (code.startsWith("8") || code.startsWith("4")) {
		return `gsbj0${code}`;
	}
	return `gssz0${code}`;
}

export async function fetchOrgId(
	code: string,
	opts: FetchOpts = {}
): Promise<string | null> {
	try {
		const res = await fetchWithRetry(
			ORG_MAP_URL,
			{
				headers: {
					"User-Agent":
						"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
				},
			},
			{ fetchImpl: opts.fetchImpl, signal: opts.signal }
		);
		if (!res.ok) {
			return null;
		}
		const json = (await res.json()) as {
			stockList?: StockListEntry[] | null;
		};
		for (const entry of json.stockList ?? []) {
			if (entry.code === code && entry.orgId) {
				return entry.orgId;
			}
		}
		return null;
	} catch {
		return null;
	}
}
