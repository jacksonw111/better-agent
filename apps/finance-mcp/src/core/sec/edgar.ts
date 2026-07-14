// SEC EDGAR connectors (US listings only): ticker→CIK mapping plus the
// recent-filings list from data.sec.gov submissions. SEC requires a
// descriptive User-Agent with a contact address on every request.
import { fetchWithRetry } from "../http";

export const SEC_USER_AGENT =
	"better-agent-finance-mcp/1.0 (devin.ai@justsayai.org)";

const TICKERS_URL = "https://www.sec.gov/files/company_tickers.json";
const SUBMISSIONS_URL = "https://data.sec.gov/submissions";
const ARCHIVES_URL = "https://www.sec.gov/Archives/edgar/data";
const CIK_DIGITS = 10;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

export interface SecFetchOpts {
	fetchImpl?: typeof fetch;
	signal?: AbortSignal;
}

export interface SecFiling {
	accessionNumber: string;
	date: string;
	description: string;
	form: string;
	primaryDocument: string;
	url: string;
}

export interface SecFilings {
	cik: string;
	companyName: string;
	filings: SecFiling[];
	ticker: string;
}

interface CikMapEntry {
	cik_str?: number | string;
	ticker?: string;
	title?: string;
}

// The full mapping (~10k companies) is fetched once per isolate and reused.
let cikMapCache: Record<string, CikMapEntry> | null = null;

export function resetCikCache(): void {
	cikMapCache = null;
}

export async function secGetJson(
	url: string,
	opts: SecFetchOpts
): Promise<unknown | null> {
	try {
		const res = await fetchWithRetry(
			url,
			{ headers: { "User-Agent": SEC_USER_AGENT } },
			{ fetchImpl: opts.fetchImpl, signal: opts.signal }
		);
		if (!res.ok) {
			return null;
		}
		return await res.json();
	} catch {
		return null;
	}
}

async function loadCikMap(
	opts: SecFetchOpts
): Promise<Record<string, CikMapEntry> | null> {
	if (cikMapCache) {
		return cikMapCache;
	}
	const json = await secGetJson(TICKERS_URL, opts);
	if (json === null || typeof json !== "object" || Array.isArray(json)) {
		return null;
	}
	cikMapCache = json as Record<string, CikMapEntry>;
	return cikMapCache;
}

// "AAPL" -> "0000320193" (zero-padded to 10 digits); null when unknown.
export async function tickerToCik(
	ticker: string,
	opts: SecFetchOpts = {}
): Promise<string | null> {
	const map = await loadCikMap(opts);
	if (!map) {
		return null;
	}
	const upper = ticker.toUpperCase();
	for (const entry of Object.values(map)) {
		if ((entry.ticker ?? "").toUpperCase() === upper) {
			return String(entry.cik_str ?? "").padStart(CIK_DIGITS, "0");
		}
	}
	return null;
}

function clampLimit(limit: number): number {
	if (!Number.isFinite(limit) || limit <= 0) {
		return DEFAULT_LIMIT;
	}
	return Math.min(Math.floor(limit), MAX_LIMIT);
}

function strings(value: unknown): string[] {
	if (!Array.isArray(value)) {
		return [];
	}
	return value.map((entry) => (typeof entry === "string" ? entry : ""));
}

// EDGAR document URLs use the unpadded CIK and the accession number with
// its dashes stripped.
function documentUrl(
	cik: string,
	accession: string,
	primaryDocument: string
): string {
	if (!(accession && primaryDocument)) {
		return "";
	}
	const accessionPath = accession.replaceAll("-", "");
	return `${ARCHIVES_URL}/${Number(cik)}/${accessionPath}/${primaryDocument}`;
}

interface RecentFilings {
	accessionNumber: string[];
	filingDate: string[];
	form: string[];
	primaryDocDescription: string[];
	primaryDocument: string[];
}

function parseRecent(data: Record<string, unknown>): RecentFilings {
	const filings =
		data.filings !== null && typeof data.filings === "object"
			? (data.filings as Record<string, unknown>)
			: {};
	const recent =
		filings.recent !== null && typeof filings.recent === "object"
			? (filings.recent as Record<string, unknown>)
			: {};
	return {
		form: strings(recent.form),
		filingDate: strings(recent.filingDate),
		accessionNumber: strings(recent.accessionNumber),
		primaryDocument: strings(recent.primaryDocument),
		primaryDocDescription: strings(recent.primaryDocDescription),
	};
}

function collectFilings(
	recent: RecentFilings,
	cik: string,
	formType: string,
	limit: number
): SecFiling[] {
	const wanted = formType.trim().toUpperCase();
	const rows: SecFiling[] = [];
	for (let i = 0; i < recent.form.length; i++) {
		const form = recent.form[i] ?? "";
		if (wanted && form.toUpperCase() !== wanted) {
			continue;
		}
		const accession = recent.accessionNumber[i] ?? "";
		const primaryDocument = recent.primaryDocument[i] ?? "";
		rows.push({
			form,
			date: recent.filingDate[i] ?? "",
			accessionNumber: accession,
			primaryDocument,
			description: recent.primaryDocDescription[i] ?? "",
			url: documentUrl(cik, accession, primaryDocument),
		});
		if (rows.length >= limit) {
			break;
		}
	}
	return rows;
}

export async function getSecFilings(
	ticker: string,
	formType: string,
	limit: number = DEFAULT_LIMIT,
	opts: SecFetchOpts = {}
): Promise<SecFilings | null> {
	const cik = await tickerToCik(ticker, opts);
	if (!cik) {
		return null;
	}
	const json = await secGetJson(`${SUBMISSIONS_URL}/CIK${cik}.json`, opts);
	if (json === null || typeof json !== "object") {
		return null;
	}
	const data = json as Record<string, unknown>;
	const recent = parseRecent(data);
	const tickers = strings(data.tickers);
	return {
		companyName: typeof data.name === "string" ? data.name : "",
		cik,
		ticker: tickers[0] ?? ticker.toUpperCase(),
		filings: collectFilings(recent, cik, formType, clampLimit(limit)),
	};
}
