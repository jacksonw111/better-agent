import { describe, expect, it } from "vitest";
import { BadSymbolError } from "../symbol";
import { getStatements } from "./statements";

describe("getStatements income", () => {
	it("normalizes an income statement row", async () => {
		const payload = {
			result: {
				data: [
					{
						REPORT_DATE: "2025-12-31 00:00:00",
						TOTAL_OPERATE_INCOME: 170_000_000_000,
						OPERATE_COST: 15_000_000_000,
						OPERATE_PROFIT: 120_000_000_000,
						TOTAL_PROFIT: 121_000_000_000,
						PARENT_NETPROFIT: 86_000_000_000,
						DEDUCT_PARENT_NETPROFIT: 85_000_000_000,
					},
				],
			},
		};
		const fetchImpl = () => Promise.resolve(Response.json(payload));
		const rows = await getStatements("600519.SH", "income", 4, {
			fetchImpl: fetchImpl as typeof fetch,
		});
		expect(rows[0]).toMatchObject({
			reportDate: "2025-12-31",
			revenue: 170_000_000_000,
			operatingCost: 15_000_000_000,
			operatingProfit: 120_000_000_000,
			totalProfit: 121_000_000_000,
			netProfit: 86_000_000_000,
			netProfitDeducted: 85_000_000_000,
		});
	});
});

describe("getStatements balance", () => {
	it("normalizes a balance-sheet row", async () => {
		const payload = {
			result: {
				data: [
					{
						REPORT_DATE: "2025-12-31 00:00:00",
						TOTAL_ASSETS: 260_000_000_000,
						TOTAL_LIABILITIES: 60_000_000_000,
						TOTAL_EQUITY: 200_000_000_000,
						MONETARYFUNDS: 40_000_000_000,
						DEBT_ASSET_RATIO: 23.1,
					},
				],
			},
		};
		const fetchImpl = () => Promise.resolve(Response.json(payload));
		const rows = await getStatements("600519.SH", "balance", 4, {
			fetchImpl: fetchImpl as typeof fetch,
		});
		expect(rows[0]).toMatchObject({
			reportDate: "2025-12-31",
			totalAssets: 260_000_000_000,
			totalLiabilities: 60_000_000_000,
			totalEquity: 200_000_000_000,
			cash: 40_000_000_000,
			debtRatio: 23.1,
		});
	});
});

describe("getStatements cashflow", () => {
	it("normalizes a cashflow row", async () => {
		const payload = {
			result: {
				data: [
					{
						REPORT_DATE: "2025-12-31 00:00:00",
						NETCASH_OPERATE: 90_000_000_000,
						NETCASH_INVEST: -10_000_000_000,
						NETCASH_FINANCE: -50_000_000_000,
						CCE_ADD: 30_000_000_000,
					},
				],
			},
		};
		const fetchImpl = () => Promise.resolve(Response.json(payload));
		const rows = await getStatements("600519.SH", "cashflow", 4, {
			fetchImpl: fetchImpl as typeof fetch,
		});
		expect(rows[0]).toMatchObject({
			reportDate: "2025-12-31",
			operatingCashflow: 90_000_000_000,
			investingCashflow: -10_000_000_000,
			financingCashflow: -50_000_000_000,
			netCashChange: 30_000_000_000,
		});
	});
});

describe("getStatements edge cases", () => {
	it("defaults an invalid statement to income", async () => {
		const payload = {
			result: { data: [{ REPORT_DATE: "2025-12-31 00:00:00" }] },
		};
		const fetchImpl = () => Promise.resolve(Response.json(payload));
		const rows = await getStatements("600519.SH", "bogus", 4, {
			fetchImpl: fetchImpl as typeof fetch,
		});
		expect(rows[0]).toMatchObject({ reportDate: "2025-12-31" });
	});

	it("degrades to [] on upstream failure", async () => {
		const fetchImpl = () =>
			Promise.resolve(new Response("not found", { status: 404 }));
		expect(
			await getStatements("600519.SH", "income", 4, {
				fetchImpl: fetchImpl as typeof fetch,
			})
		).toEqual([]);
	});

	it("throws BadSymbolError for non-A symbols", async () => {
		await expect(getStatements("AAPL", "income", 4)).rejects.toThrow(
			BadSymbolError
		);
	});
});
