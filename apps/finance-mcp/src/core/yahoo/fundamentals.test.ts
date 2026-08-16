import { beforeEach, describe, expect, it } from "vitest";
import { getUsKeyMetrics, getUsProfile } from "./fundamentals";
import { resetYahooAuthCache } from "./session";

const SET_COOKIE = "A3=d=abc; Domain=.yahoo.com; Path=/";

const METRICS_SUMMARY = {
	price: {
		longName: "Apple Inc.",
		shortName: "Apple",
		currency: "USD",
		regularMarketPrice: { raw: 231.59 },
		regularMarketChangePercent: { raw: 0.0125 },
		marketCap: { raw: 3_500_000_000_000 },
	},
	summaryDetail: {
		trailingPE: { raw: 35.2 },
		forwardPE: { raw: 30.1 },
		priceToSalesTrailing12Months: { raw: 8.9 },
		beta: { raw: 1.24 },
		dividendYield: { raw: 0.0044 },
		fiftyTwoWeekHigh: { raw: 260.1 },
		fiftyTwoWeekLow: { raw: 169.2 },
	},
	defaultKeyStatistics: {
		priceToBook: { raw: 61.4 },
		pegRatio: { raw: 2.4 },
		trailingEps: { raw: 6.58 },
		sharesOutstanding: { raw: 15_100_000_000 },
	},
	financialData: {
		returnOnEquity: { raw: 1.4725 },
		grossMargins: { raw: 0.4621 },
		profitMargins: { raw: 0.2568 },
		targetMeanPrice: { raw: 250.5 },
	},
};

const PROFILE_SUMMARY = {
	assetProfile: {
		sector: "Technology",
		industry: "Consumer Electronics",
		website: "https://www.apple.com",
		fullTimeEmployees: 161_000,
		country: "United States",
		city: "Cupertino",
		longBusinessSummary: "Apple designs smartphones.",
	},
	price: {
		longName: "Apple Inc.",
		exchangeName: "NasdaqGS",
	},
};

function stubFor(summary: unknown, expectedModules: string): typeof fetch {
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
		if (href.includes("/v10/finance/quoteSummary/")) {
			expect(href).toContain(`modules=${expectedModules}`);
			return Promise.resolve(
				Response.json({ quoteSummary: { result: [summary] } })
			);
		}
		throw new Error(`unexpected URL in test: ${href}`);
	}) as typeof fetch;
}

beforeEach(() => {
	resetYahooAuthCache();
});

describe("getUsKeyMetrics", () => {
	it("maps the four quoteSummary modules and converts fractions to percent", async () => {
		const metrics = await getUsKeyMetrics("aapl", {
			fetchImpl: stubFor(
				METRICS_SUMMARY,
				"price,summaryDetail,defaultKeyStatistics,financialData"
			),
		});
		expect(metrics).toEqual({
			symbol: "AAPL",
			name: "Apple Inc.",
			currency: "USD",
			close: 231.59,
			changePct: 1.25,
			marketCap: 3_500_000_000_000,
			peTtm: 35.2,
			peForward: 30.1,
			pb: 61.4,
			ps: 8.9,
			peg: 2.4,
			epsTtm: 6.58,
			beta: 1.24,
			dividendYieldPct: 0.44,
			high52w: 260.1,
			low52w: 169.2,
			sharesOutstanding: 15_100_000_000,
			roePct: 147.25,
			grossMarginPct: 46.21,
			netMarginPct: 25.68,
			targetMeanPrice: 250.5,
		});
	});

	it("returns nulls for missing modules and null on fetch failure", async () => {
		const sparse = await getUsKeyMetrics("AAPL", {
			fetchImpl: stubFor(
				{ price: { regularMarketPrice: { raw: 10 } } },
				"price"
			),
		});
		expect(sparse).toMatchObject({ close: 10, peTtm: null, roePct: null });

		const failing = (() =>
			Promise.resolve(new Response("", { status: 404 }))) as typeof fetch;
		expect(await getUsKeyMetrics("AAPL", { fetchImpl: failing })).toBeNull();
	});
});

describe("getUsProfile", () => {
	it("maps assetProfile + price onto the profile shape", async () => {
		const profile = await getUsProfile("AAPL", {
			fetchImpl: stubFor(PROFILE_SUMMARY, "assetProfile,price"),
		});
		expect(profile).toEqual({
			symbol: "AAPL",
			name: "Apple Inc.",
			exchange: "NasdaqGS",
			sector: "Technology",
			industry: "Consumer Electronics",
			website: "https://www.apple.com",
			employees: 161_000,
			country: "United States",
			city: "Cupertino",
			summary: "Apple designs smartphones.",
		});
	});
});
