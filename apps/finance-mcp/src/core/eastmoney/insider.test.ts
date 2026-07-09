import { describe, expect, it } from "vitest";
import { getInsiderTrades } from "./insider";

describe("getInsiderTrades normalization", () => {
	it("normalizes RPT_EXECUTIVE_HOLD_DETAILS rows incl holdType/person/position", async () => {
		const payload = {
			result: {
				data: [
					{
						SECURITY_CODE: "300750",
						SECURITY_NAME: "宁德时代",
						CHANGE_DATE: "2026-07-06 00:00:00",
						PERSON_NAME: "张三",
						CHANGE_SHARES: 50_000,
						AVERAGE_PRICE: 188.5,
						CHANGE_AMOUNT: 9_425_000,
						CHANGE_REASON: "集中竞价",
						CHANGE_RATIO: 0.02,
						HOLD_TYPE: "减持",
						POSITION_NAME: "副总经理",
						DSE_PERSON_NAME: "张三配偶",
					},
				],
			},
		};
		const fetchImpl = () => Promise.resolve(Response.json(payload));
		const rows = await getInsiderTrades(undefined, 20, {
			fetchImpl: fetchImpl as typeof fetch,
		});
		expect(rows[0]).toMatchObject({
			changeDate: "2026-07-06",
			code: "300750",
			name: "宁德时代",
			person: "张三",
			position: "副总经理",
			holdType: "减持",
			changeShares: 50_000,
			avgPrice: 188.5,
			changeAmount: 9_425_000,
			changeRatio: 0.02,
			relatedExec: "张三配偶",
			reason: "集中竞价",
		});
	});
});

describe("getInsiderTrades normalization: missing fields", () => {
	it("maps missing fields to null/empty-string instead of throwing", async () => {
		const payload = {
			result: { data: [{ CHANGE_DATE: "2026-07-06 00:00:00" }] },
		};
		const fetchImpl = () => Promise.resolve(Response.json(payload));
		const rows = await getInsiderTrades(undefined, 20, {
			fetchImpl: fetchImpl as typeof fetch,
		});
		expect(rows[0]).toMatchObject({
			code: "",
			name: "",
			person: "",
			position: "",
			holdType: "",
			changeShares: null,
			avgPrice: null,
			changeAmount: null,
			changeRatio: null,
			relatedExec: "",
			reason: "",
		});
	});
});

describe("getInsiderTrades request URL", () => {
	it("symbol path filters by SECURITY_CODE, sorted newest-first", async () => {
		const fetchImpl = (url: string | URL | Request) => {
			const href = String(url);
			expect(href).toContain("reportName=RPT_EXECUTIVE_HOLD_DETAILS");
			expect(href).toContain('filter=(SECURITY_CODE="300750")');
			expect(href).toContain("sortColumns=CHANGE_DATE&sortTypes=-1");
			return Promise.resolve(Response.json({ result: { data: [] } }));
		};
		await getInsiderTrades("300750.SZ", 20, {
			fetchImpl: fetchImpl as typeof fetch,
		});
	});

	it("market-wide path omits the SECURITY_CODE filter", async () => {
		const fetchImpl = (url: string | URL | Request) => {
			expect(String(url)).not.toContain("SECURITY_CODE");
			return Promise.resolve(Response.json({ result: { data: [] } }));
		};
		await getInsiderTrades(undefined, 20, {
			fetchImpl: fetchImpl as typeof fetch,
		});
	});
});

describe("getInsiderTrades edge cases", () => {
	it("degrades to [] on upstream failure", async () => {
		const fetchImpl = () =>
			Promise.resolve(new Response("not found", { status: 404 }));
		expect(
			await getInsiderTrades(undefined, 20, {
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
		await getInsiderTrades(undefined, OVER_MAX_LIMIT, {
			fetchImpl: fetchImpl as typeof fetch,
		});
	});
});
