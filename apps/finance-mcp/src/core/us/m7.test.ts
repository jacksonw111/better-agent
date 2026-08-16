import { beforeEach, describe, expect, it } from "vitest";
import { resetYahooAuthCache } from "../yahoo/session";
import { getM7 } from "./m7";

const SET_COOKIE = "A3=d=abc; Domain=.yahoo.com; Path=/";

// Two rows are enough to exercise mapping/sorting/aggregation; upstream
// order is NVDA-last to prove the by-cap sort.
const QUOTES = [
	{
		symbol: "AAPL",
		shortName: "Apple Inc.",
		regularMarketPrice: 305.93,
		regularMarketChangePercent: 0.219_479,
		marketCap: 4_000_000_000_000,
		trailingPE: 35.08,
		forwardPE: 32.18,
		epsTrailingTwelveMonths: 8.72,
		priceToBook: 41.57,
		fiftyTwoWeekHigh: 344.57,
		fiftyTwoWeekLow: 223.78,
		fiftyTwoWeekHighChangePercent: -0.112_139_806,
		regularMarketVolume: 26_072_932,
	},
	{
		symbol: "NVDA",
		shortName: "NVIDIA Corporation",
		regularMarketPrice: 180,
		regularMarketChangePercent: -1.5,
		marketCap: 5_000_000_000_000,
		fiftyTwoWeekHighChangePercent: 0,
	},
];

function stubFor(): typeof fetch {
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
			expect(href).toContain(
				"symbols=AAPL%2CMSFT%2CGOOGL%2CAMZN%2CNVDA%2CMETA%2CTSLA"
			);
			return Promise.resolve(
				Response.json({ quoteResponse: { result: QUOTES } })
			);
		}
		throw new Error(`unexpected URL in test: ${href}`);
	}) as typeof fetch;
}

beforeEach(() => {
	resetYahooAuthCache();
});

describe("getM7", () => {
	it("maps quotes, sorts by market cap, and aggregates the basket", async () => {
		const snapshot = await getM7({ fetchImpl: stubFor() });
		expect(snapshot?.stocks.map((s) => s.symbol)).toEqual(["NVDA", "AAPL"]);
		expect(snapshot?.stocks[1]).toEqual({
			changePct: 0.22,
			epsTtm: 8.72,
			fromHigh52wPct: 11.21,
			high52w: 344.57,
			low52w: 223.78,
			marketCap: 4_000_000_000_000,
			name: "Apple Inc.",
			pb: 41.57,
			peForward: 32.18,
			peTtm: 35.08,
			price: 305.93,
			symbol: "AAPL",
			volume: 26_072_932,
		});
		expect(snapshot).toMatchObject({
			advancers: 1,
			decliners: 1,
			totalMarketCap: 9_000_000_000_000,
		});
		// (5T * -1.5 + 4T * 0.22) / 9T = -0.7355... -> -0.74
		expect(snapshot?.capWeightedChangePct).toBe(-0.74);
	});

	it("returns null when quotes are unavailable", async () => {
		const failing = (() =>
			Promise.resolve(new Response("", { status: 404 }))) as typeof fetch;
		expect(await getM7({ fetchImpl: failing })).toBeNull();
	});
});
