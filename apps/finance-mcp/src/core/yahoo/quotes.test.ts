import { beforeEach, describe, expect, it } from "vitest";
import { plainNum, yahooQuotes } from "./quotes";
import { resetYahooAuthCache } from "./session";

const SET_COOKIE = "A3=d=abc; Domain=.yahoo.com; Path=/";

function stubFor(result: unknown): typeof fetch {
	return ((url: string | URL | Request) => {
		const href = String(url);
		if (href.startsWith("https://fc.yahoo.com")) {
			return Promise.resolve(
				new Response("", { headers: { "set-cookie": SET_COOKIE } })
			);
		}
		if (href.includes("/v1/test/getcrumb")) {
			return Promise.resolve(new Response("crumb-1"));
		}
		if (href.includes("/v7/finance/quote")) {
			expect(href).toContain("symbols=AAPL%2CMSFT");
			expect(href).toContain("crumb=crumb-1");
			return Promise.resolve(Response.json({ quoteResponse: { result } }));
		}
		throw new Error(`unexpected URL in test: ${href}`);
	}) as typeof fetch;
}

beforeEach(() => {
	resetYahooAuthCache();
});

describe("yahooQuotes", () => {
	it("fetches all symbols in one authenticated call", async () => {
		const rows = await yahooQuotes(["AAPL", "MSFT"], {
			fetchImpl: stubFor([{ symbol: "AAPL" }, { symbol: "MSFT" }]),
		});
		expect(rows).toEqual([{ symbol: "AAPL" }, { symbol: "MSFT" }]);
	});

	it("returns [] for empty input, missing result, or auth failure", async () => {
		expect(await yahooQuotes([])).toEqual([]);
		expect(
			await yahooQuotes(["AAPL", "MSFT"], { fetchImpl: stubFor(null) })
		).toEqual([]);

		const noCookie = (() =>
			Promise.resolve(new Response("", { status: 404 }))) as typeof fetch;
		expect(await yahooQuotes(["AAPL"], { fetchImpl: noCookie })).toEqual([]);
	});
});

describe("plainNum", () => {
	it("accepts finite numbers only", () => {
		expect(plainNum(1.5)).toBe(1.5);
		expect(plainNum(Number.NaN)).toBeNull();
		expect(plainNum("1.5")).toBeNull();
		expect(plainNum({ raw: 1.5 })).toBeNull();
	});
});
