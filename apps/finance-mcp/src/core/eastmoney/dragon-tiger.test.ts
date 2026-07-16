import { describe, expect, it } from "vitest";
import { getDragonTiger } from "./dragon-tiger";

describe("getDragonTiger normalization", () => {
	it("normalizes RPT_DAILYBILLBOARD_DETAILSNEW rows", async () => {
		const payload = {
			result: {
				data: [
					{
						TRADE_DATE: "2026-07-07 00:00:00",
						SECURITY_CODE: "600519",
						SECURITY_NAME_ABBR: "贵州茅台",
						CLOSE_PRICE: 1680.5,
						CHANGE_RATE: 9.98,
						TURNOVERRATE: 12.3,
						BILLBOARD_DEAL_AMT: 500_000_000,
						EXPLAIN: "日跌幅偏离值达7%",
					},
				],
			},
		};
		const fetchImpl = () => Promise.resolve(Response.json(payload));
		const rows = await getDragonTiger("2026-07-07", 30, {
			fetchImpl: fetchImpl as typeof fetch,
		});
		expect(rows[0]).toMatchObject({
			tradeDate: "2026-07-07",
			code: "600519",
			name: "贵州茅台",
			close: 1680.5,
			changePct: 9.98,
			turnoverRate: 12.3,
			billboardAmount: 500_000_000,
			reason: "日跌幅偏离值达7%",
		});
	});

	it("omits the date filter and sorts by TRADE_DATE desc (most recent session) when date is empty", async () => {
		let requestedUrl = "";
		const fetchImpl = (url: string) => {
			requestedUrl = url;
			return Promise.resolve(Response.json({ result: { data: [] } }));
		};
		await getDragonTiger("", 30, { fetchImpl: fetchImpl as typeof fetch });
		// No date FILTER, but TRADE_DATE leads the sort so the newest session
		// comes first (the report spans all history).
		expect(requestedUrl).not.toContain("filter=(TRADE_DATE");
		expect(requestedUrl).toContain("sortColumns=TRADE_DATE,BILLBOARD_DEAL_AMT");
	});
});

describe("getDragonTiger edge cases", () => {
	it("degrades to [] on upstream failure", async () => {
		const fetchImpl = () =>
			Promise.resolve(new Response("not found", { status: 404 }));
		expect(
			await getDragonTiger("", 30, { fetchImpl: fetchImpl as typeof fetch })
		).toEqual([]);
	});
});
