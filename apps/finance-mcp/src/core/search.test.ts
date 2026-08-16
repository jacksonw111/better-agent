import { describe, expect, it } from "vitest";
import { searchStocks } from "./search";

const EM_JSONP = `jsonp(${JSON.stringify({
	QuotationCodeTable: {
		Data: [{ Classify: "AStock", Code: "600519", Name: "贵州茅台" }],
	},
})})`;

const YAHOO_QUOTES = {
	quotes: [
		{
			exchDisp: "NASDAQ",
			longname: "Apple Inc.",
			quoteType: "EQUITY",
			symbol: "AAPL",
		},
	],
};

function stubFor(emOk: boolean): typeof fetch {
	return ((url: string | URL | Request) => {
		const href = String(url);
		if (href.includes("searchapi.eastmoney.com")) {
			return emOk
				? Promise.resolve(new Response(EM_JSONP))
				: Promise.reject(new Error("eastmoney down"));
		}
		if (href.includes("/v1/finance/search")) {
			return Promise.resolve(Response.json(YAHOO_QUOTES));
		}
		throw new Error(`unexpected URL in test: ${href}`);
	}) as typeof fetch;
}

describe("searchStocks", () => {
	it("merges A-share and US hits with a market discriminator", async () => {
		const hits = await searchStocks("apple", { fetchImpl: stubFor(true) });
		expect(hits).toEqual([
			{ code: "600519", exchange: "SH", market: "a_share", name: "贵州茅台" },
			{
				code: "AAPL",
				exchange: "NASDAQ",
				market: "us",
				name: "Apple Inc.",
				type: "EQUITY",
			},
		]);
	});

	it("still returns US hits when the A-share upstream fails", async () => {
		const hits = await searchStocks("apple", { fetchImpl: stubFor(false) });
		expect(hits).toEqual([
			{
				code: "AAPL",
				exchange: "NASDAQ",
				market: "us",
				name: "Apple Inc.",
				type: "EQUITY",
			},
		]);
	});
});
