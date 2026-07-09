import { describe, expect, it } from "vitest";
import { getHolderCount } from "./holder-count";

const HOLDER_COUNT_PAYLOAD = {
	result: {
		data: [
			{
				END_DATE: "2025-12-31 00:00:00",
				HOLDER_TOTAL_NUM: 65_000,
				TOTAL_NUM_RATIO: -3.2,
				HOLDER_A_NUM: 64_800,
				AVG_FREE_SHARES: 18_500,
				AVG_FREESHARES_RATIO: 3.5,
			},
			{
				END_DATE: "2025-09-30 00:00:00",
				HOLDER_TOTAL_NUM: 67_150,
				TOTAL_NUM_RATIO: 1.1,
				HOLDER_A_NUM: 66_900,
				AVG_FREE_SHARES: 17_900,
				AVG_FREESHARES_RATIO: -1.0,
			},
		],
	},
};

describe("getHolderCount normalization", () => {
	it("maps EastMoney fields, slicing END_DATE to a plain date", async () => {
		const fetchImpl = (url: string | URL | Request) => {
			expect(String(url)).toContain("reportName=RPT_F10_EH_HOLDERNUM");
			expect(String(url)).toContain('filter=(SECUCODE="600519.SH")');
			return Promise.resolve(Response.json(HOLDER_COUNT_PAYLOAD));
		};
		const rows = await getHolderCount("600519.SH", {
			fetchImpl: fetchImpl as typeof fetch,
		});
		expect(rows).toHaveLength(2);
		expect(rows[0]).toEqual({
			endDate: "2025-12-31",
			totalHolders: 65_000,
			changeRatio: -3.2,
			avgFreeShares: 18_500,
			avgFreeSharesRatio: 3.5,
		});
	});

	it("null-safes missing fields", async () => {
		const fetchImpl = () =>
			Promise.resolve(
				Response.json({ result: { data: [{ END_DATE: null }] } })
			);
		const rows = await getHolderCount("000001.SZ", {
			fetchImpl: fetchImpl as typeof fetch,
		});
		expect(rows[0]).toEqual({
			endDate: "",
			totalHolders: null,
			changeRatio: null,
			avgFreeShares: null,
			avgFreeSharesRatio: null,
		});
	});
});

describe("getHolderCount edge cases", () => {
	it("degrades to [] on upstream failure", async () => {
		const fetchImpl = () =>
			Promise.resolve(new Response("not found", { status: 404 }));
		expect(
			await getHolderCount("600519.SH", {
				fetchImpl: fetchImpl as typeof fetch,
			})
		).toEqual([]);
	});

	it("degrades to [] for non-A symbols", async () => {
		expect(await getHolderCount("AAPL")).toEqual([]);
	});
});
