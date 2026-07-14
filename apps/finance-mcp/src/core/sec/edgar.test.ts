import { beforeEach, describe, expect, it } from "vitest";
import {
	getSecFilings,
	resetCikCache,
	SEC_USER_AGENT,
	tickerToCik,
} from "./edgar";

const TICKERS_PAYLOAD = {
	"0": { cik_str: 320_193, ticker: "AAPL", title: "Apple Inc." },
	"1": { cik_str: 1_318_605, ticker: "TSLA", title: "Tesla, Inc." },
};

const SUBMISSIONS_PAYLOAD = {
	name: "Apple Inc.",
	tickers: ["AAPL"],
	filings: {
		recent: {
			form: ["10-K", "8-K", "10-Q"],
			filingDate: ["2024-11-01", "2024-10-31", "2024-08-02"],
			accessionNumber: [
				"0000320193-24-000123",
				"0000320193-24-000120",
				"0000320193-24-000081",
			],
			primaryDocument: ["aapl-20240928.htm", "", "aapl-20240629.htm"],
			primaryDocDescription: ["10-K", "8-K", "10-Q"],
		},
	},
};

function stubFor(urls: string[]): typeof fetch {
	return ((url: string | URL | Request, init?: RequestInit) => {
		const href = String(url);
		urls.push(href);
		const headers = (init?.headers ?? {}) as Record<string, string>;
		expect(headers["User-Agent"]).toBe(SEC_USER_AGENT);
		if (href.includes("company_tickers.json")) {
			return Promise.resolve(Response.json(TICKERS_PAYLOAD));
		}
		if (href.includes("data.sec.gov/submissions/CIK0000320193.json")) {
			return Promise.resolve(Response.json(SUBMISSIONS_PAYLOAD));
		}
		throw new Error(`unexpected URL in test: ${href}`);
	}) as typeof fetch;
}

const failingFetch = (() =>
	Promise.resolve(new Response("nope", { status: 404 }))) as typeof fetch;

beforeEach(() => {
	resetCikCache();
});

describe("tickerToCik", () => {
	it("matches case-insensitively and zero-pads to 10 digits", async () => {
		const urls: string[] = [];
		const fetchImpl = stubFor(urls);
		expect(await tickerToCik("aapl", { fetchImpl })).toBe("0000320193");
		expect(await tickerToCik("TSLA", { fetchImpl })).toBe("0001318605");
		// The mapping table is fetched once and cached.
		expect(urls).toHaveLength(1);
	});

	it("returns null for unknown tickers and on fetch failure", async () => {
		const urls: string[] = [];
		expect(await tickerToCik("NOPE", { fetchImpl: stubFor(urls) })).toBeNull();
		resetCikCache();
		expect(await tickerToCik("AAPL", { fetchImpl: failingFetch })).toBeNull();
	});
});

describe("getSecFilings: happy path", () => {
	it("maps the parallel recent arrays and builds document URLs", async () => {
		const filings = await getSecFilings("AAPL", "", 20, {
			fetchImpl: stubFor([]),
		});
		expect(filings?.companyName).toBe("Apple Inc.");
		expect(filings?.cik).toBe("0000320193");
		expect(filings?.ticker).toBe("AAPL");
		expect(filings?.filings).toHaveLength(3);
		expect(filings?.filings[0]).toEqual({
			form: "10-K",
			date: "2024-11-01",
			accessionNumber: "0000320193-24-000123",
			primaryDocument: "aapl-20240928.htm",
			description: "10-K",
			url: "https://www.sec.gov/Archives/edgar/data/320193/000032019324000123/aapl-20240928.htm",
		});
		// No primaryDocument -> no URL.
		expect(filings?.filings[1]?.url).toBe("");
	});

	it("filters by form type and respects the limit", async () => {
		const fetchImpl = stubFor([]);
		const tenK = await getSecFilings("AAPL", "10-K", 20, { fetchImpl });
		expect(tenK?.filings.map((f) => f.form)).toEqual(["10-K"]);
		const capped = await getSecFilings("AAPL", "", 2, { fetchImpl });
		expect(capped?.filings).toHaveLength(2);
	});
});

describe("getSecFilings: degradation", () => {
	it("returns null when the ticker is unknown", async () => {
		expect(
			await getSecFilings("NOPE", "", 20, { fetchImpl: stubFor([]) })
		).toBeNull();
	});

	it("returns null when the submissions fetch fails", async () => {
		const fetchImpl = ((url: string | URL | Request) => {
			if (String(url).includes("company_tickers.json")) {
				return Promise.resolve(Response.json(TICKERS_PAYLOAD));
			}
			return Promise.resolve(new Response("nope", { status: 404 }));
		}) as typeof fetch;
		expect(await getSecFilings("AAPL", "", 20, { fetchImpl })).toBeNull();
	});
});
