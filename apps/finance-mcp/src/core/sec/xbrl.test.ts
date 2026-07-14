import { beforeEach, describe, expect, it } from "vitest";
import { resetCikCache } from "./edgar";
import { getXbrlFacts } from "./xbrl";

const TICKERS_PAYLOAD = {
	"0": { cik_str: 320_193, ticker: "AAPL", title: "Apple Inc." },
};

const FACTS_PAYLOAD = {
	entityName: "Apple Inc.",
	facts: {
		"us-gaap": {
			NetIncomeLoss: {
				label: "Net Income (Loss)",
				units: {
					USD: [
						{
							end: "2024-09-28",
							val: 93_736_000_000,
							form: "10-K",
							filed: "2024-11-01",
							fy: 2024,
							fp: "FY",
						},
						{
							end: "2024-06-29",
							val: 21_448_000_000,
							form: "10-Q",
							filed: "2024-08-02",
							fy: 2024,
							fp: "Q3",
						},
						{ end: "2024-10-31", val: 1, form: "8-K", filed: "2024-10-31" },
					],
				},
			},
			EarningsPerShareDiluted: {
				label: "EPS Diluted",
				units: {
					"USD/shares": [
						{
							end: "2024-09-28",
							val: 6.08,
							form: "10-K",
							filed: "2024-11-01",
							fy: 2024,
							fp: "FY",
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

describe("getXbrlFacts: metric listing (no metrics requested)", () => {
	it("lists available us-gaap metrics with label and units", async () => {
		const facts = await getXbrlFacts("AAPL", [], { fetchImpl: stubFor() });
		expect(facts).toEqual({
			company: "Apple Inc.",
			totalMetrics: 2,
			availableMetrics: [
				{
					name: "NetIncomeLoss",
					label: "Net Income (Loss)",
					units: ["USD"],
				},
				{
					name: "EarningsPerShareDiluted",
					label: "EPS Diluted",
					units: ["USD/shares"],
				},
			],
		});
	});
});

describe("getXbrlFacts: metric extraction", () => {
	it("keeps only 10-K/10-Q entries from the USD unit", async () => {
		const facts = await getXbrlFacts("AAPL", ["NetIncomeLoss"], {
			fetchImpl: stubFor(),
		});
		expect(facts).toEqual({
			company: "Apple Inc.",
			metrics: {
				NetIncomeLoss: [
					{
						end: "2024-09-28",
						val: 93_736_000_000,
						form: "10-K",
						filed: "2024-11-01",
						fy: 2024,
						fp: "FY",
					},
					{
						end: "2024-06-29",
						val: 21_448_000_000,
						form: "10-Q",
						filed: "2024-08-02",
						fy: 2024,
						fp: "Q3",
					},
				],
			},
		});
	});

	it("falls back to the first unit when USD is absent; unknown metric -> []", async () => {
		const facts = await getXbrlFacts(
			"AAPL",
			["EarningsPerShareDiluted", "Bogus"],
			{ fetchImpl: stubFor() }
		);
		expect(facts).toMatchObject({
			metrics: {
				EarningsPerShareDiluted: [{ val: 6.08, form: "10-K" }],
				Bogus: [],
			},
		});
	});
});

describe("getXbrlFacts: degradation", () => {
	it("returns null when the companyfacts fetch fails", async () => {
		const fetchImpl = ((url: string | URL | Request) => {
			if (String(url).includes("company_tickers.json")) {
				return Promise.resolve(Response.json(TICKERS_PAYLOAD));
			}
			return Promise.resolve(new Response("nope", { status: 404 }));
		}) as typeof fetch;
		expect(await getXbrlFacts("AAPL", [], { fetchImpl })).toBeNull();
	});

	it("returns null when the ticker cannot be mapped to a CIK", async () => {
		expect(await getXbrlFacts("NOPE", [], { fetchImpl: stubFor() })).toBeNull();
	});
});
