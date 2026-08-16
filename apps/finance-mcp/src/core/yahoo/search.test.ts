import { describe, expect, it } from "vitest";
import { searchUsStocks } from "./search";

const QUOTES = [
	{
		exchDisp: "NASDAQ",
		longname: "Apple Inc.",
		quoteType: "EQUITY",
		shortname: "Apple Inc.",
		symbol: "AAPL",
	},
	// Foreign listings carry a dot suffix — filtered out.
	{
		exchDisp: "XETRA",
		longname: "Apple Inc.",
		quoteType: "EQUITY",
		symbol: "APC.DE",
	},
	{
		exchDisp: "Toronto",
		longname: "Harvest Apple ETF",
		quoteType: "ETF",
		symbol: "APLE.TO",
	},
	// Non-equity/ETF quote types are filtered out.
	{ exchDisp: "SNP", longname: "S&P 500", quoteType: "INDEX", symbol: "^GSPC" },
	{
		exchDisp: "NYSE",
		quoteType: "ETF",
		shortname: "SPDR S&P 500",
		symbol: "SPY",
	},
];

function stubFor(payload: unknown, status = 200): typeof fetch {
	return ((url: string | URL | Request) => {
		const href = String(url);
		expect(href).toContain("/v1/finance/search?q=apple");
		return Promise.resolve(
			status === 200 ? Response.json(payload) : new Response("", { status })
		);
	}) as typeof fetch;
}

describe("searchUsStocks", () => {
	it("keeps dot-free EQUITY/ETF hits and maps names", async () => {
		const hits = await searchUsStocks("apple", {
			fetchImpl: stubFor({ quotes: QUOTES }),
		});
		expect(hits).toEqual([
			{
				exchange: "NASDAQ",
				name: "Apple Inc.",
				symbol: "AAPL",
				type: "EQUITY",
			},
			// longname absent -> shortname fallback.
			{ exchange: "NYSE", name: "SPDR S&P 500", symbol: "SPY", type: "ETF" },
		]);
	});

	it("respects the limit option", async () => {
		const hits = await searchUsStocks("apple", {
			fetchImpl: stubFor({ quotes: QUOTES }),
			limit: 1,
		});
		expect(hits).toEqual([
			{
				exchange: "NASDAQ",
				name: "Apple Inc.",
				symbol: "AAPL",
				type: "EQUITY",
			},
		]);
	});

	it("degrades to [] on HTTP error or missing quotes", async () => {
		expect(
			await searchUsStocks("apple", { fetchImpl: stubFor({}, 404) })
		).toEqual([]);
		expect(await searchUsStocks("apple", { fetchImpl: stubFor({}) })).toEqual(
			[]
		);
	});
});
