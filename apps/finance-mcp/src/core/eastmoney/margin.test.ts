import { describe, expect, it } from "vitest";
import { getMargin } from "./margin";

const DEFAULT_LIMIT = 10;

describe("getMargin normalization: field mapping", () => {
	it("normalizes RPTA_WEB_RZRQ_GGMX rows", async () => {
		const payload = {
			result: {
				data: [
					{
						DATE: "2026-07-07 00:00:00",
						SCODE: "600519",
						SECNAME: "贵州茅台",
						RZYE: 123_456.78,
						RQYE: 9876.54,
						RQYL: 12_345,
						RZRQYE: 133_333.32,
						RZMRE: 5432.1,
						RQMCL: 678,
						RZYEZB: 1.23,
					},
				],
			},
		};
		const fetchImpl = () => Promise.resolve(Response.json(payload));
		const rows = await getMargin("600519.SH", DEFAULT_LIMIT, {
			fetchImpl: fetchImpl as typeof fetch,
		});
		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({
			date: "2026-07-07",
			financingBalance: 123_456.78,
			financingBuy: 5432.1,
			securitiesBalance: 9876.54,
			securitiesVolume: 12_345,
			totalBalance: 133_333.32,
			financingBalanceRatio: 1.23,
		});
	});
});

describe("getMargin normalization: null-safety", () => {
	it("maps missing fields to null instead of throwing", async () => {
		const payload = { result: { data: [{ DATE: "2026-07-07 00:00:00" }] } };
		const fetchImpl = () => Promise.resolve(Response.json(payload));
		const rows = await getMargin("600519.SH", DEFAULT_LIMIT, {
			fetchImpl: fetchImpl as typeof fetch,
		});
		expect(rows[0]).toMatchObject({
			date: "2026-07-07",
			financingBalance: null,
			financingBuy: null,
			securitiesBalance: null,
			securitiesVolume: null,
			totalBalance: null,
			financingBalanceRatio: null,
		});
	});
});

describe("getMargin normalization: request URL", () => {
	it("hits the datacenter-web report endpoint with the 6-digit code", async () => {
		const fetchImpl = (url: string | URL | Request) => {
			const href = String(url);
			expect(href).toContain("reportName=RPTA_WEB_RZRQ_GGMX");
			expect(href).toContain('filter=(scode="600519")');
			expect(href).toContain("pageSize=10");
			return Promise.resolve(Response.json({ result: { data: [] } }));
		};
		await getMargin("600519.SH", DEFAULT_LIMIT, {
			fetchImpl: fetchImpl as typeof fetch,
		});
	});
});

describe("getMargin edge cases", () => {
	it("returns [] for non-A symbols (no fetch performed)", async () => {
		const fetchImpl = () => {
			throw new Error("must not fetch for non-A symbols");
		};
		const rows = await getMargin("AAPL", DEFAULT_LIMIT, {
			fetchImpl: fetchImpl as typeof fetch,
		});
		expect(rows).toEqual([]);
	});

	it("degrades to [] on upstream failure", async () => {
		const fetchImpl = () =>
			Promise.resolve(new Response("not found", { status: 404 }));
		expect(
			await getMargin("600519.SH", DEFAULT_LIMIT, {
				fetchImpl: fetchImpl as typeof fetch,
			})
		).toEqual([]);
	});

	it("clamps limit to the 60 max and defaults to 10", async () => {
		const OVER_MAX_LIMIT = 999;
		const fetchImpl = (url: string | URL | Request) => {
			expect(String(url)).toContain("pageSize=60");
			return Promise.resolve(Response.json({ result: { data: [] } }));
		};
		await getMargin("600519.SH", OVER_MAX_LIMIT, {
			fetchImpl: fetchImpl as typeof fetch,
		});
	});
});
