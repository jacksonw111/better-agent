import { describe, expect, it } from "vitest";
import { BadSymbolError } from "../symbol";
import { getTopHolders } from "./top-holders";

const MIXED_PERIOD_PAYLOAD = {
	result: {
		data: [
			{
				END_DATE: "2025-12-31 00:00:00",
				HOLDER_RANK: 2,
				HOLDER_NAME: "香港中央结算有限公司",
				HOLD_NUM: 90_000_000,
				FREE_HOLDNUM_RATIO: 7.1,
				HOLD_NUM_CHANGE: 1_000_000,
				CHANGE_RATIO: 1.1,
				IS_HOLDORG: "1",
			},
			{
				END_DATE: "2025-12-31 00:00:00",
				HOLDER_RANK: 1,
				HOLDER_NAME: "贵州茅台集团有限责任公司",
				HOLD_NUM: 500_000_000,
				FREE_HOLDNUM_RATIO: 39.2,
				HOLD_NUM_CHANGE: 0,
				CHANGE_RATIO: 0,
				IS_HOLDORG: "1",
			},
			{
				END_DATE: "2025-09-30 00:00:00",
				HOLDER_RANK: 1,
				HOLDER_NAME: "旧股东",
				HOLD_NUM: 400_000_000,
				FREE_HOLDNUM_RATIO: 35,
				HOLD_NUM_CHANGE: 0,
				CHANGE_RATIO: 0,
				IS_HOLDORG: "0",
			},
		],
	},
};

describe("getTopHolders normalization", () => {
	it("filters to the latest END_DATE and sorts by HOLDER_RANK asc", async () => {
		const fetchImpl = () =>
			Promise.resolve(Response.json(MIXED_PERIOD_PAYLOAD));
		const rows = await getTopHolders("600519.SH", {
			fetchImpl: fetchImpl as typeof fetch,
		});
		expect(rows).toHaveLength(2);
		expect(rows[0]).toMatchObject({
			endDate: "2025-12-31",
			rank: 1,
			holder: "贵州茅台集团有限责任公司",
			shares: 500_000_000,
			freeFloatRatio: 39.2,
			changeShares: 0,
			changeRatio: 0,
			isInstitution: true,
		});
		expect(rows[1]).toMatchObject({
			rank: 2,
			holder: "香港中央结算有限公司",
			isInstitution: true,
		});
	});
});

describe("getTopHolders edge cases", () => {
	it("degrades to [] on upstream failure", async () => {
		const fetchImpl = () =>
			Promise.resolve(new Response("not found", { status: 404 }));
		expect(
			await getTopHolders("600519.SH", {
				fetchImpl: fetchImpl as typeof fetch,
			})
		).toEqual([]);
	});

	it("throws BadSymbolError for non-A symbols", async () => {
		await expect(getTopHolders("AAPL")).rejects.toThrow(BadSymbolError);
	});
});
