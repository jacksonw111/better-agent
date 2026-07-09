import { describe, expect, it } from "vitest";
import { BadSymbolError } from "../symbol";
import { getDividends } from "./dividends";

describe("getDividends normalization", () => {
	it("normalizes RPT_SHAREBONUS_DET rows", async () => {
		const payload = {
			result: {
				data: [
					{
						REPORT_DATE: "2025-12-31 00:00:00",
						PLAN_NOTICE_DATE: "2026-03-15 00:00:00",
						IMPL_PLAN_PROFILE: "10派15元(含税)",
						BONUS_IT_RATIO: 0,
						BONUS_RATIO: 0,
						PRETAX_BONUS_RMB: 1.5,
						EQUITY_RECORD_DATE: "2026-04-10 00:00:00",
						EX_DIVIDEND_DATE: "2026-04-11 00:00:00",
						ASSIGN_PROGRESS: "实施分配",
					},
				],
			},
		};
		const fetchImpl = () => Promise.resolve(Response.json(payload));
		const rows = await getDividends("600519.SH", 10, {
			fetchImpl: fetchImpl as typeof fetch,
		});
		expect(rows[0]).toMatchObject({
			reportDate: "2025-12-31",
			noticeDate: "2026-03-15",
			plan: "10派15元(含税)",
			bonusRatioTransfer: 0,
			bonusRatioDividend: 0,
			pretaxDividendRmb: 1.5,
			recordDate: "2026-04-10",
			exDividendDate: "2026-04-11",
			progress: "实施分配",
		});
	});

	it("defaults plan to an empty string when IMPL_PLAN_PROFILE is absent", async () => {
		const payload = {
			result: { data: [{ REPORT_DATE: "2025-12-31 00:00:00" }] },
		};
		const fetchImpl = () => Promise.resolve(Response.json(payload));
		const rows = await getDividends("600519.SH", 10, {
			fetchImpl: fetchImpl as typeof fetch,
		});
		expect(rows[0]?.plan).toBe("");
	});
});

describe("getDividends edge cases", () => {
	it("degrades to [] on upstream failure", async () => {
		const fetchImpl = () =>
			Promise.resolve(new Response("not found", { status: 404 }));
		expect(
			await getDividends("600519.SH", 10, {
				fetchImpl: fetchImpl as typeof fetch,
			})
		).toEqual([]);
	});

	it("throws BadSymbolError for non-A symbols", async () => {
		await expect(getDividends("AAPL", 10)).rejects.toThrow(BadSymbolError);
	});
});
