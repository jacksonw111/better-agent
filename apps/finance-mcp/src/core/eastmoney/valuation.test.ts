import { describe, expect, it } from "vitest";
import { BadSymbolError } from "../symbol";
import { getKeyMetrics } from "./valuation";

describe("getKeyMetrics normalization", () => {
	it("normalizes RPT_VALUEANALYSIS_DET row", async () => {
		const payload = {
			result: {
				data: [
					{
						TRADE_DATE: "2026-07-08 00:00:00",
						CLOSE_PRICE: 1688.0,
						CHANGE_RATE: 0.53,
						TOTAL_MARKET_CAP: 2_120_000_000_000,
						NOTLIMITED_MARKETCAP_A: 2_120_000_000_000,
						TOTAL_SHARES: 1_256_197_800,
						FREE_SHARES_A: 1_256_197_800,
						PE_TTM: 21.5,
						PE_LAR: 22.1,
						PB_MRQ: 8.4,
						PS_TTM: 11.2,
						PCF_OCF_TTM: 19.3,
						PEG_CAR: 1.8,
					},
				],
			},
		};
		const fetchImpl = () => Promise.resolve(Response.json(payload));
		const metrics = await getKeyMetrics("600519.SH", {
			fetchImpl: fetchImpl as typeof fetch,
		});
		expect(metrics).toMatchObject({
			symbol: "600519.SH",
			tradeDate: "2026-07-08",
			close: 1688.0,
			changePct: 0.53,
			marketCap: 2_120_000_000_000,
			floatMarketCap: 2_120_000_000_000,
			totalShares: 1_256_197_800,
			floatShares: 1_256_197_800,
			peTtm: 21.5,
			peStatic: 22.1,
			pb: 8.4,
			ps: 11.2,
			pcf: 19.3,
			peg: 1.8,
		});
	});
});

describe("getKeyMetrics edge cases", () => {
	it("returns null on empty result", async () => {
		const fetchImpl = () =>
			Promise.resolve(Response.json({ result: { data: [] } }));
		expect(
			await getKeyMetrics("600519.SH", { fetchImpl: fetchImpl as typeof fetch })
		).toBeNull();
	});

	it("degrades to null on upstream failure", async () => {
		const fetchImpl = () =>
			Promise.resolve(new Response("not found", { status: 404 }));
		expect(
			await getKeyMetrics("600519.SH", { fetchImpl: fetchImpl as typeof fetch })
		).toBeNull();
	});

	it("throws BadSymbolError for non-A symbols", async () => {
		await expect(getKeyMetrics("00700.HK")).rejects.toThrow(BadSymbolError);
	});
});
