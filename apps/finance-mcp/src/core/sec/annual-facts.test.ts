import { beforeEach, describe, expect, it } from "vitest";
import { getAnnualFacts } from "./annual-facts";
import { resetCikCache } from "./edgar";

const TICKERS_PAYLOAD = {
	"0": { cik_str: 320_193, ticker: "AAPL", title: "Apple Inc." },
};

const FACTS_PAYLOAD = {
	entityName: "Apple Inc.",
	facts: {
		"us-gaap": {
			// Legacy tag with stale years only — must lose to the modern tag
			// below even though it is listed first in the fallback order.
			Revenues: {
				units: {
					USD: [
						{
							start: "2016-09-25",
							end: "2017-09-30",
							val: 229_000_000_000,
							form: "10-K",
							filed: "2017-11-03",
							fp: "FY",
						},
					],
				},
			},
			// Modern revenue tag: annual FY entries plus a quarterly comparative
			// that is also stamped fy/FY inside the 10-K (must be excluded by
			// the duration check), plus a restated duplicate of FY2023.
			RevenueFromContractWithCustomerExcludingAssessedTax: {
				units: {
					USD: [
						{
							start: "2022-09-25",
							end: "2023-09-30",
							val: 383_000_000_000,
							form: "10-K",
							filed: "2023-11-03",
							fp: "FY",
						},
						{
							start: "2022-09-25",
							end: "2023-09-30",
							val: 383_285_000_000,
							form: "10-K",
							filed: "2024-11-01",
							fp: "FY",
						},
						{
							start: "2023-10-01",
							end: "2024-09-28",
							val: 391_035_000_000,
							form: "10-K",
							filed: "2024-11-01",
							fp: "FY",
						},
						{
							start: "2024-06-30",
							end: "2024-09-28",
							val: 94_930_000_000,
							form: "10-K",
							filed: "2024-11-01",
							fp: "FY",
						},
						{
							start: "2024-03-31",
							end: "2024-06-29",
							val: 85_777_000_000,
							form: "10-Q",
							filed: "2024-08-02",
							fp: "Q3",
						},
					],
				},
			},
			// Instant fact: no start date, accepted on form/fp alone.
			Assets: {
				units: {
					USD: [
						{
							end: "2024-09-28",
							val: 364_980_000_000,
							form: "10-K",
							filed: "2024-11-01",
							fp: "FY",
						},
						{
							end: "2024-06-29",
							val: 331_612_000_000,
							form: "10-Q",
							filed: "2024-08-02",
							fp: "Q3",
						},
					],
				},
			},
		},
	},
};

function stubFor(): typeof fetch {
	return ((url: string | URL | Request) => {
		const href = String(url);
		if (href.includes("company_tickers.json")) {
			return Promise.resolve(Response.json(TICKERS_PAYLOAD));
		}
		if (href.includes("api/xbrl/companyfacts/CIK0000320193.json")) {
			return Promise.resolve(Response.json(FACTS_PAYLOAD));
		}
		throw new Error(`unexpected URL in test: ${href}`);
	}) as typeof fetch;
}

beforeEach(() => {
	resetCikCache();
});

describe("getAnnualFacts: annual selection", () => {
	it("keeps year-long 10-K FY entries, deduped by end on latest filing", async () => {
		const facts = await getAnnualFacts(
			"AAPL",
			[
				{
					key: "revenue",
					tags: [
						"Revenues",
						"RevenueFromContractWithCustomerExcludingAssessedTax",
					],
				},
			],
			{ fetchImpl: stubFor() }
		);
		// Ascending by end; FY2023 takes the restated 2024-filed value; the
		// quarterly comparatives (Q4 duration, 10-Q) are dropped.
		expect(facts).toEqual({
			company: "Apple Inc.",
			series: {
				revenue: [
					{ end: "2023-09-30", val: 383_285_000_000 },
					{ end: "2024-09-28", val: 391_035_000_000 },
				],
			},
		});
	});

	it("accepts instant facts without a start date, 10-K FY only", async () => {
		const facts = await getAnnualFacts(
			"AAPL",
			[{ key: "totalAssets", tags: ["Assets"] }],
			{ fetchImpl: stubFor() }
		);
		expect(facts?.series.totalAssets).toEqual([
			{ end: "2024-09-28", val: 364_980_000_000 },
		]);
	});

	it("returns [] when no candidate tag has data", async () => {
		const facts = await getAnnualFacts(
			"AAPL",
			[
				{
					key: "eps",
					tags: ["EarningsPerShareDiluted", "EarningsPerShareBasic"],
				},
			],
			{ fetchImpl: stubFor() }
		);
		expect(facts?.series.eps).toEqual([]);
	});
});

describe("getAnnualFacts: degradation", () => {
	it("returns null on unknown ticker or failed companyfacts fetch", async () => {
		expect(
			await getAnnualFacts("NOPE", [], { fetchImpl: stubFor() })
		).toBeNull();

		const failing = ((url: string | URL | Request) => {
			if (String(url).includes("company_tickers.json")) {
				return Promise.resolve(Response.json(TICKERS_PAYLOAD));
			}
			return Promise.resolve(new Response("nope", { status: 404 }));
		}) as typeof fetch;
		expect(await getAnnualFacts("AAPL", [], { fetchImpl: failing })).toBeNull();
	});
});
