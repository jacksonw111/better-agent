import { describe, expect, it } from "vitest";
import { getHsgtFlow } from "./hsgt";

const NORTH_ROW = {
	TRADE_DATE: "2026-07-08 00:00:00",
	MUTUAL_TYPE: "001",
	NET_DEAL_AMT: null,
	BUY_AMT: 123.4,
	SELL_AMT: 100.2,
	LEAD_STOCKS_NAME: "贵州茅台",
	INDEX_CLOSE_PRICE: 3000.1,
	INDEX_CHANGE_RATE: 0.5,
};
const SOUTH_ROW = {
	TRADE_DATE: "2026-07-08 00:00:00",
	MUTUAL_TYPE: "002",
	NET_DEAL_AMT: 5678.9,
	BUY_AMT: 200,
	SELL_AMT: 50,
	LEAD_STOCKS_NAME: "腾讯控股",
	INDEX_CLOSE_PRICE: 18_000,
	INDEX_CHANGE_RATE: -0.2,
};

describe("getHsgtFlow", () => {
	it("maps channel labels/direction and preserves northbound null", async () => {
		const payload = { result: { data: [NORTH_ROW, SOUTH_ROW] } };
		const fetchImpl = () => Promise.resolve(Response.json(payload));
		const rows = await getHsgtFlow(10, {
			fetchImpl: fetchImpl as typeof fetch,
		});
		expect(rows).toHaveLength(2);
		expect(rows[0]).toMatchObject({
			tradeDate: "2026-07-08",
			channel: "沪股通",
			direction: "north",
			netAmt: null,
			buyAmt: 123.4,
			sellAmt: 100.2,
			leadStock: "贵州茅台",
			indexChangeRate: 0.5,
		});
		expect(rows[1]).toMatchObject({
			tradeDate: "2026-07-08",
			channel: "港股通(沪)",
			direction: "south",
			netAmt: 5678.9,
		});
	});

	it("degrades to [] on non-OK response", async () => {
		const fetchImpl = () => Promise.resolve(new Response("", { status: 500 }));
		const rows = await getHsgtFlow(10, {
			fetchImpl: fetchImpl as typeof fetch,
		});
		expect(rows).toEqual([]);
	});
});
