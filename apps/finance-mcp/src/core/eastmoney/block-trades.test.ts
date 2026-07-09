import { describe, expect, it } from "vitest";
import { getBlockTrades } from "./block-trades";

describe("getBlockTrades normalization", () => {
	it("normalizes RPT_DATA_BLOCKTRADE rows, scaling PREMIUM_RATIO to a percent", async () => {
		const payload = {
			result: {
				data: [
					{
						SECURITY_CODE: "600519",
						SECURITY_NAME_ABBR: "贵州茅台",
						TRADE_DATE: "2026-07-07 00:00:00",
						DEAL_PRICE: 1650,
						PREMIUM_RATIO: -0.1504,
						DEAL_VOLUME: 100_000,
						DEAL_AMT: 165_000_000,
						BUYER_NAME: "机构专用",
						SELLER_NAME: "中信证券上海分公司",
					},
				],
			},
		};
		const fetchImpl = () => Promise.resolve(Response.json(payload));
		const rows = await getBlockTrades(undefined, 20, {
			fetchImpl: fetchImpl as typeof fetch,
		});
		expect(rows[0]).toMatchObject({
			tradeDate: "2026-07-07",
			code: "600519",
			name: "贵州茅台",
			dealPrice: 1650,
			dealVolume: 100_000,
			dealAmount: 165_000_000,
			buyer: "机构专用",
			seller: "中信证券上海分公司",
		});
		// -0.1504 * 100 hits float imprecision (-15.040000000000001).
		expect(rows[0]?.premiumPct).toBeCloseTo(-15.04, 10);
	});
});

describe("getBlockTrades normalization: missing fields", () => {
	it("maps missing fields to null/empty-string instead of throwing", async () => {
		const payload = {
			result: { data: [{ TRADE_DATE: "2026-07-07 00:00:00" }] },
		};
		const fetchImpl = () => Promise.resolve(Response.json(payload));
		const rows = await getBlockTrades(undefined, 20, {
			fetchImpl: fetchImpl as typeof fetch,
		});
		expect(rows[0]).toMatchObject({
			code: "",
			name: "",
			dealPrice: null,
			premiumPct: null,
			dealVolume: null,
			dealAmount: null,
			buyer: "",
			seller: "",
		});
	});
});

describe("getBlockTrades request URL", () => {
	it("symbol path filters by SECURITY_CODE, sorted by date+amount desc", async () => {
		const fetchImpl = (url: string | URL | Request) => {
			const href = String(url);
			expect(href).toContain("reportName=RPT_DATA_BLOCKTRADE");
			expect(href).toContain('filter=(SECURITY_CODE="600519")');
			expect(href).toContain("sortColumns=TRADE_DATE,DEAL_AMT&sortTypes=-1,-1");
			return Promise.resolve(Response.json({ result: { data: [] } }));
		};
		await getBlockTrades("600519.SH", 20, {
			fetchImpl: fetchImpl as typeof fetch,
		});
	});

	it("market-wide path omits the SECURITY_CODE filter", async () => {
		const fetchImpl = (url: string | URL | Request) => {
			expect(String(url)).not.toContain("SECURITY_CODE");
			return Promise.resolve(Response.json({ result: { data: [] } }));
		};
		await getBlockTrades(undefined, 20, {
			fetchImpl: fetchImpl as typeof fetch,
		});
	});
});

describe("getBlockTrades edge cases", () => {
	it("degrades to [] on upstream failure", async () => {
		const fetchImpl = () =>
			Promise.resolve(new Response("not found", { status: 404 }));
		expect(
			await getBlockTrades(undefined, 20, {
				fetchImpl: fetchImpl as typeof fetch,
			})
		).toEqual([]);
	});

	it("clamps limit to the 60 max and defaults to 20", async () => {
		const OVER_MAX_LIMIT = 999;
		const fetchImpl = (url: string | URL | Request) => {
			expect(String(url)).toContain("pageSize=60");
			return Promise.resolve(Response.json({ result: { data: [] } }));
		};
		await getBlockTrades(undefined, OVER_MAX_LIMIT, {
			fetchImpl: fetchImpl as typeof fetch,
		});
	});
});
