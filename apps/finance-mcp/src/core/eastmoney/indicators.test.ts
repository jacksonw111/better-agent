import { describe, expect, it } from "vitest";
import { BadSymbolError } from "../symbol";
import { getFinancialIndicators } from "./indicators";

describe("getFinancialIndicators normalization", () => {
	it("normalizes RPT_F10_FINANCE_MAINFINADATA rows", async () => {
		const payload = {
			result: {
				data: [
					{
						REPORT_DATE: "2025-12-31 00:00:00",
						REPORT_DATE_NAME: "2025年年报",
						EPSJB: 68.5,
						BPS: 220.3,
						TOTALOPERATEREVE: 170_000_000_000,
						TOTALOPERATEREVETZ: 8.2,
						PARENTNETPROFIT: 86_000_000_000,
						PARENTNETPROFITTZ: 7.1,
						XSMLL: 91.4,
						XSJLL: 50.6,
						ROEJQ: 34.2,
						ROEKCJQ: 33.8,
						ZCFZL: 23.1,
						MGJYXJJE: 65.4,
					},
				],
			},
		};
		const fetchImpl = () => Promise.resolve(Response.json(payload));
		const rows = await getFinancialIndicators("600519.SH", 8, {
			fetchImpl: fetchImpl as typeof fetch,
		});
		expect(rows[0]).toMatchObject({
			reportDate: "2025-12-31",
			reportName: "2025年年报",
			eps: 68.5,
			bps: 220.3,
			revenue: 170_000_000_000,
			revenueYoy: 8.2,
			netProfit: 86_000_000_000,
			netProfitYoy: 7.1,
			grossMargin: 91.4,
			netMargin: 50.6,
			roe: 34.2,
			roeDeducted: 33.8,
			debtRatio: 23.1,
			opCashPerShare: 65.4,
		});
	});
});

describe("getFinancialIndicators edge cases", () => {
	it("degrades to [] on upstream failure", async () => {
		const fetchImpl = () =>
			Promise.resolve(new Response("not found", { status: 404 }));
		expect(
			await getFinancialIndicators("600519.SH", 8, {
				fetchImpl: fetchImpl as typeof fetch,
			})
		).toEqual([]);
	});

	it("throws BadSymbolError for non-A symbols", async () => {
		await expect(getFinancialIndicators("AAPL", 8)).rejects.toThrow(
			BadSymbolError
		);
	});
});
