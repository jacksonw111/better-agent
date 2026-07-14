import { beforeEach, describe, expect, it } from "vitest";
import { getAnalystRatings } from "./analyst";
import { resetYahooAuthCache } from "./session";

const SET_COOKIE = "A3=d=abc; Domain=.yahoo.com; Path=/";
// 2024-01-01T00:00:00Z — a fixed, hand-checkable epoch for the date test.
const EPOCH_2024_01_01 = 1_704_067_200;
const HISTORY_OVERFLOW = 25;
const HISTORY_CAP = 20;

const SUMMARY = {
	earningsTrend: {
		trend: [
			{
				period: "0q",
				endDate: "2026-09-30",
				earningsEstimate: {
					avg: { raw: 2.1 },
					high: { raw: 2.4 },
					low: { raw: 1.9 },
					numberOfAnalysts: { raw: 28 },
				},
				revenueEstimate: { avg: { raw: 102_000_000_000 } },
			},
		],
	},
	recommendationTrend: {
		trend: [
			{ period: "0m", strongBuy: 12, buy: 20, hold: 8, sell: 1, strongSell: 0 },
		],
	},
	upgradeDowngradeHistory: {
		history: [
			{
				epochGradeDate: EPOCH_2024_01_01,
				firm: "Morgan Stanley",
				toGrade: "Overweight",
				fromGrade: "Equal-Weight",
				action: "up",
			},
		],
	},
};

function stubFor(summary: unknown): typeof fetch {
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
			expect(href).toContain(
				"modules=earningsTrend,recommendationTrend,upgradeDowngradeHistory"
			);
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

describe("getAnalystRatings: field extraction", () => {
	it("maps the three quoteSummary modules onto typed rows", async () => {
		const ratings = await getAnalystRatings("AAPL", {
			fetchImpl: stubFor(SUMMARY),
		});
		expect(ratings?.epsTrend[0]).toEqual({
			period: "0q",
			endDate: "2026-09-30",
			epsEstimate: 2.1,
			epsHigh: 2.4,
			epsLow: 1.9,
			revenueEstimate: 102_000_000_000,
			numAnalysts: 28,
		});
		expect(ratings?.ratingTrend[0]).toEqual({
			period: "0m",
			strongBuy: 12,
			buy: 20,
			hold: 8,
			sell: 1,
			strongSell: 0,
		});
		expect(ratings?.upgradeDowngrade[0]).toEqual({
			date: "2024-01-01",
			firm: "Morgan Stanley",
			toGrade: "Overweight",
			fromGrade: "Equal-Weight",
			action: "up",
		});
	});

	it("caps the upgrade/downgrade history at 20 entries", async () => {
		const entries = Array.from({ length: HISTORY_OVERFLOW }, (_, i) => ({
			epochGradeDate: EPOCH_2024_01_01 + i,
			firm: `Firm ${i}`,
			toGrade: "Buy",
			fromGrade: "Hold",
			action: "up",
		}));
		const ratings = await getAnalystRatings("AAPL", {
			fetchImpl: stubFor({ upgradeDowngradeHistory: { history: entries } }),
		});
		expect(ratings?.upgradeDowngrade).toHaveLength(HISTORY_CAP);
		expect(ratings?.upgradeDowngrade[0]?.firm).toBe("Firm 0");
	});
});

describe("getAnalystRatings: degradation", () => {
	it("returns null when the quoteSummary fetch fails", async () => {
		const fetchImpl = (() =>
			Promise.resolve(new Response("", { status: 404 }))) as typeof fetch;
		expect(await getAnalystRatings("AAPL", { fetchImpl })).toBeNull();
	});

	it("returns empty arrays when modules are missing from the result", async () => {
		const ratings = await getAnalystRatings("AAPL", { fetchImpl: stubFor({}) });
		expect(ratings).toEqual({
			epsTrend: [],
			ratingTrend: [],
			upgradeDowngrade: [],
		});
	});
});
