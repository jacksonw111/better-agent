import { beforeEach, describe, expect, it } from "vitest";
import {
	getCompanyProfile,
	getFinancialIndicators,
	getKeyMetrics,
	getStatements,
} from "./fundamentals";
import { BadSymbolError } from "./symbol";
import { resetYahooAuthCache } from "./yahoo/session";

const SET_COOKIE = "A3=d=abc; Domain=.yahoo.com; Path=/";

// One stub covering both upstreams: EastMoney datacenter for A-shares and
// the Yahoo cookie/crumb + quoteSummary legs for US tickers.
function routingStub(): { fetchImpl: typeof fetch; urls: string[] } {
	const urls: string[] = [];
	const fetchImpl = ((url: string | URL | Request) => {
		const href = String(url);
		urls.push(href);
		if (href.startsWith("https://fc.yahoo.com")) {
			return Promise.resolve(
				new Response("", { headers: { "set-cookie": SET_COOKIE } })
			);
		}
		if (href.includes("/v1/test/getcrumb")) {
			return Promise.resolve(new Response("crumb-1"));
		}
		if (href.includes("/v10/finance/quoteSummary/")) {
			return Promise.resolve(
				Response.json({
					quoteSummary: {
						result: [{ price: { regularMarketPrice: { raw: 231.5 } } }],
					},
				})
			);
		}
		if (href.includes("datacenter-web.eastmoney.com")) {
			return Promise.resolve(
				Response.json({
					result: { data: [{ CLOSE_PRICE: 1700, TRADE_DATE: "2026-08-14" }] },
				})
			);
		}
		throw new Error(`unexpected URL in test: ${href}`);
	}) as typeof fetch;
	return { fetchImpl, urls };
}

beforeEach(() => {
	resetYahooAuthCache();
});

describe("fundamentals routing", () => {
	it("routes US symbols to Yahoo and uppercases the ticker", async () => {
		const { fetchImpl, urls } = routingStub();
		const metrics = await getKeyMetrics("aapl", { fetchImpl });
		expect(metrics).toMatchObject({ symbol: "AAPL", close: 231.5 });
		expect(urls.some((u) => u.includes("quoteSummary/aapl"))).toBe(false);
	});

	it("routes A-share symbols to EastMoney", async () => {
		const { fetchImpl, urls } = routingStub();
		const metrics = await getKeyMetrics("600519.SH", { fetchImpl });
		expect(metrics).toMatchObject({ symbol: "600519.SH", close: 1700 });
		expect(urls.every((u) => u.includes("eastmoney.com"))).toBe(true);
	});

	it("rejects HK symbols with a clear BadSymbolError on every entry point", () => {
		const { fetchImpl } = routingStub();
		expect(() => getKeyMetrics("00700.HK", { fetchImpl })).toThrow(
			BadSymbolError
		);
		expect(() => getCompanyProfile("00700.HK", { fetchImpl })).toThrow(
			BadSymbolError
		);
		expect(() => getStatements("00700.HK", "income", 4, { fetchImpl })).toThrow(
			BadSymbolError
		);
		expect(() => getFinancialIndicators("00700.HK", 8, { fetchImpl })).toThrow(
			BadSymbolError
		);
	});
});
