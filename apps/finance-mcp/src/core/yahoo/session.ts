// Yahoo Finance auth layer: the v7/v10 endpoints (quoteSummary, options)
// require a cookie + crumb pair. Two legs: (1) GET fc.yahoo.com with a
// browser UA to receive a set-cookie, (2) GET v1/test/getcrumb with that
// cookie — the body is the crumb. Cached module-level for 30 minutes.
import { fetchWithRetry } from "../http";

export interface YahooAuth {
	cookie: string;
	crumb: string;
}

interface FetchOpts {
	fetchImpl?: typeof fetch;
	signal?: AbortSignal;
}

const COOKIE_URL = "https://fc.yahoo.com";
const CRUMB_URL = "https://query2.finance.yahoo.com/v1/test/getcrumb";
const QUOTE_SUMMARY_URL =
	"https://query2.finance.yahoo.com/v10/finance/quoteSummary";
export const YAHOO_USER_AGENT =
	"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36";

const MINUTES_30_MS = 30 * 60 * 1000;
const AUTH_TTL_MS = MINUTES_30_MS;

let cached: { auth: YahooAuth; expiresAt: number } | null = null;

export function resetYahooAuthCache(): void {
	cached = null;
}

// Standard request headers once authenticated (cookie + browser UA).
export function yahooAuthHeaders(auth: YahooAuth): Record<string, string> {
	return { Cookie: auth.cookie, "User-Agent": YAHOO_USER_AGENT };
}

async function fetchCookie(opts: FetchOpts): Promise<string | null> {
	// fc.yahoo.com responds with a redirect/404 either way — only the
	// set-cookie header matters, so redirects must not be followed.
	const res = await fetchWithRetry(
		COOKIE_URL,
		{
			redirect: "manual",
			headers: { "User-Agent": YAHOO_USER_AGENT },
		},
		{ fetchImpl: opts.fetchImpl, signal: opts.signal }
	);
	const setCookie = res.headers.get("set-cookie");
	if (!setCookie) {
		return null;
	}
	const cookie = (setCookie.split(";")[0] ?? "").trim();
	return cookie.length > 0 ? cookie : null;
}

async function fetchCrumb(
	cookie: string,
	opts: FetchOpts
): Promise<string | null> {
	const res = await fetchWithRetry(
		CRUMB_URL,
		{ headers: { Cookie: cookie, "User-Agent": YAHOO_USER_AGENT } },
		{ fetchImpl: opts.fetchImpl, signal: opts.signal }
	);
	if (!res.ok) {
		return null;
	}
	const crumb = (await res.text()).trim();
	return crumb.length > 0 ? crumb : null;
}

export async function getYahooAuth(
	opts: FetchOpts = {}
): Promise<YahooAuth | null> {
	if (cached && Date.now() < cached.expiresAt) {
		return cached.auth;
	}
	try {
		const cookie = await fetchCookie(opts);
		if (!cookie) {
			return null;
		}
		const crumb = await fetchCrumb(cookie, opts);
		if (!crumb) {
			return null;
		}
		const auth: YahooAuth = { cookie, crumb };
		cached = { auth, expiresAt: Date.now() + AUTH_TTL_MS };
		return auth;
	} catch {
		return null;
	}
}

// Unified quoteSummary query: returns quoteSummary.result[0] or null.
export async function yahooQuoteSummary(
	symbol: string,
	modules: string[],
	opts: FetchOpts = {}
): Promise<Record<string, unknown> | null> {
	const auth = await getYahooAuth(opts);
	if (!auth) {
		return null;
	}
	const url = `${QUOTE_SUMMARY_URL}/${encodeURIComponent(symbol)}?modules=${modules.join(",")}&crumb=${encodeURIComponent(auth.crumb)}`;
	try {
		const res = await fetchWithRetry(
			url,
			{ headers: yahooAuthHeaders(auth) },
			{ fetchImpl: opts.fetchImpl, signal: opts.signal }
		);
		if (!res.ok) {
			return null;
		}
		const json = (await res.json()) as {
			quoteSummary?: { result?: Record<string, unknown>[] | null } | null;
		};
		return json.quoteSummary?.result?.[0] ?? null;
	} catch {
		return null;
	}
}

// Yahoo wraps most numbers as {raw, fmt}; some fields (volume, counts) come
// back as plain numbers. Accept both, null otherwise.
export function rawNum(value: unknown): number | null {
	if (typeof value === "number") {
		return Number.isFinite(value) ? value : null;
	}
	if (value !== null && typeof value === "object" && "raw" in value) {
		const raw = (value as { raw?: unknown }).raw;
		if (typeof raw === "number" && Number.isFinite(raw)) {
			return raw;
		}
	}
	return null;
}
