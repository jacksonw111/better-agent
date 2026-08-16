import { beforeEach, describe, expect, it } from "vitest";
import { resetCikCache } from "./edgar";
import { getUsIndicators, getUsStatements } from "./us-financials";

const TICKERS_PAYLOAD = {
	"0": { cik_str: 320_193, ticker: "AAPL", title: "Apple Inc." },
};

function annual(end: string, start: string, val: number) {
	return { start, end, val, form: "10-K", filed: "2024-11-01", fp: "FY" };
}

function instant(end: string, val: number) {
	return { end, val, form: "10-K", filed: "2024-11-01", fp: "FY" };
}

const FY23 = ["2023-09-30", "2022-09-25"] as const;
const FY24 = ["2024-09-28", "2023-10-01"] as const;

const FACTS_PAYLOAD = {
	entityName: "Apple Inc.",
	facts: {
		"us-gaap": {
			RevenueFromContractWithCustomerExcludingAssessedTax: {
				units: {
					USD: [annual(...FY23, 100_000), annual(...FY24, 120_000)],
				},
			},
			CostOfGoodsAndServicesSold: {
				units: { USD: [annual(...FY23, 60_000), annual(...FY24, 66_000)] },
			},
			OperatingIncomeLoss: {
				units: { USD: [annual(...FY23, 30_000), annual(...FY24, 39_000)] },
			},
			NetIncomeLoss: {
				units: { USD: [annual(...FY23, 24_000), annual(...FY24, 30_000)] },
			},
			EarningsPerShareDiluted: {
				units: { "USD/shares": [annual(...FY23, 1.5), annual(...FY24, 2)] },
			},
			Assets: {
				units: { USD: [instant("2024-09-28", 200_000)] },
			},
			Liabilities: {
				units: { USD: [instant("2024-09-28", 120_000)] },
			},
			StockholdersEquity: {
				units: { USD: [instant("2024-09-28", 80_000)] },
			},
			CashAndCashEquivalentsAtCarryingValue: {
				units: { USD: [instant("2024-09-28", 25_000)] },
			},
			NetCashProvidedByUsedInOperatingActivities: {
				units: { USD: [annual(...FY24, 40_000)] },
			},
			NetCashProvidedByUsedInInvestingActivities: {
				units: { USD: [annual(...FY24, -10_000)] },
			},
			NetCashProvidedByUsedInFinancingActivities: {
				units: { USD: [annual(...FY24, -28_000)] },
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

describe("getUsStatements", () => {
	it("builds annual income rows, newest first, respecting periods", async () => {
		const rows = await getUsStatements("AAPL", "income", 1, {
			fetchImpl: stubFor(),
		});
		expect(rows).toEqual([
			{
				reportDate: "2024-09-28",
				revenue: 120_000,
				operatingCost: 66_000,
				grossProfit: null,
				operatingProfit: 39_000,
				netProfit: 30_000,
				eps: 2,
			},
		]);
	});

	it("computes debtRatio on balance rows", async () => {
		const rows = await getUsStatements("AAPL", "balance", 4, {
			fetchImpl: stubFor(),
		});
		expect(rows).toEqual([
			{
				reportDate: "2024-09-28",
				totalAssets: 200_000,
				totalLiabilities: 120_000,
				totalEquity: 80_000,
				cash: 25_000,
				debtRatio: 60,
			},
		]);
	});

	it("returns cashflow rows and [] for unknown tickers", async () => {
		const rows = await getUsStatements("AAPL", "cashflow", 4, {
			fetchImpl: stubFor(),
		});
		expect(rows[0]).toMatchObject({
			operatingCashflow: 40_000,
			investingCashflow: -10_000,
			financingCashflow: -28_000,
		});
		expect(
			await getUsStatements("NOPE", "income", 4, { fetchImpl: stubFor() })
		).toEqual([]);
	});
});

describe("getUsIndicators", () => {
	it("derives margins, YoY growth, ROE and debtRatio per fiscal year", async () => {
		const rows = await getUsIndicators("AAPL", 8, { fetchImpl: stubFor() });
		expect(rows).toEqual([
			{
				reportDate: "2024-09-28",
				reportName: "FY2024",
				eps: 2,
				revenue: 120_000,
				revenueYoy: 20,
				netProfit: 30_000,
				netProfitYoy: 25,
				grossMargin: 45,
				netMargin: 25,
				roe: 37.5,
				debtRatio: 60,
			},
			{
				reportDate: "2023-09-30",
				reportName: "FY2023",
				eps: 1.5,
				revenue: 100_000,
				revenueYoy: null,
				netProfit: 24_000,
				netProfitYoy: null,
				grossMargin: 40,
				netMargin: 24,
				roe: null,
				debtRatio: null,
			},
		]);
	});

	it("respects the periods cap, keeping the newest rows", async () => {
		const rows = await getUsIndicators("AAPL", 1, { fetchImpl: stubFor() });
		expect(rows).toHaveLength(1);
		expect(rows[0]?.reportName).toBe("FY2024");
	});
});
