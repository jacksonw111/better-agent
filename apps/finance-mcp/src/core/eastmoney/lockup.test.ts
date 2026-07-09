import { describe, expect, it } from "vitest";
import { getLockup } from "./lockup";

describe("getLockup normalization", () => {
	it("normalizes RPT_LIFT_STAGE rows", async () => {
		const payload = {
			result: {
				data: [
					{
						FREE_DATE: "2026-08-15 00:00:00",
						SECURITY_CODE: "600519",
						SECURITY_NAME_ABBR: "贵州茅台",
						FREE_SHARES: 12_345_678,
						FREE_RATIO: 1.23,
						LIFT_MARKET_CAP: 987_654_321,
						FREE_SHARES_TYPE: "定向增发机构配售股份",
					},
				],
			},
		};
		const fetchImpl = () => Promise.resolve(Response.json(payload));
		const rows = await getLockup("600519.SH", 20, {
			fetchImpl: fetchImpl as typeof fetch,
		});
		expect(rows[0]).toMatchObject({
			freeDate: "2026-08-15",
			code: "600519",
			name: "贵州茅台",
			freeShares: 12_345_678,
			freeRatio: 1.23,
			liftMarketCap: 987_654_321,
			type: "定向增发机构配售股份",
		});
	});

	it("maps missing fields to null/empty-string instead of throwing", async () => {
		const payload = {
			result: { data: [{ FREE_DATE: "2026-08-15 00:00:00" }] },
		};
		const fetchImpl = () => Promise.resolve(Response.json(payload));
		const rows = await getLockup("600519.SH", 20, {
			fetchImpl: fetchImpl as typeof fetch,
		});
		expect(rows[0]).toMatchObject({
			code: "",
			name: "",
			freeShares: null,
			freeRatio: null,
			liftMarketCap: null,
			type: "",
		});
	});
});

describe("getLockup request URL", () => {
	it("symbol path filters by SECURITY_CODE, sorted newest-first", async () => {
		const fetchImpl = (url: string | URL | Request) => {
			const href = String(url);
			expect(href).toContain("reportName=RPT_LIFT_STAGE");
			expect(href).toContain('filter=(SECURITY_CODE="600519")');
			expect(href).toContain("sortColumns=FREE_DATE&sortTypes=-1");
			return Promise.resolve(Response.json({ result: { data: [] } }));
		};
		await getLockup("600519.SH", 20, {
			fetchImpl: fetchImpl as typeof fetch,
		});
	});

	it("market-wide path filters FREE_DATE>=today (from opts.now), sorted soonest-first", async () => {
		const fixedNow = Date.parse("2026-07-09T00:00:00Z");
		const fetchImpl = (url: string | URL | Request) => {
			const href = String(url);
			expect(href).toContain("filter=(FREE_DATE>='2026-07-09')");
			expect(href).toContain("sortColumns=FREE_DATE&sortTypes=1");
			expect(href).not.toContain("SECURITY_CODE");
			return Promise.resolve(Response.json({ result: { data: [] } }));
		};
		await getLockup(undefined, 20, {
			fetchImpl: fetchImpl as typeof fetch,
			now: fixedNow,
		});
	});
});

describe("getLockup edge cases", () => {
	it("degrades to [] on upstream failure", async () => {
		const fetchImpl = () =>
			Promise.resolve(new Response("not found", { status: 404 }));
		expect(
			await getLockup(undefined, 20, { fetchImpl: fetchImpl as typeof fetch })
		).toEqual([]);
	});

	it("clamps limit to the 60 max and defaults to 20", async () => {
		const OVER_MAX_LIMIT = 999;
		const fetchImpl = (url: string | URL | Request) => {
			expect(String(url)).toContain("pageSize=60");
			return Promise.resolve(Response.json({ result: { data: [] } }));
		};
		await getLockup(undefined, OVER_MAX_LIMIT, {
			fetchImpl: fetchImpl as typeof fetch,
		});
	});
});
