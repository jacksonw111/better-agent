import { describe, expect, it } from "vitest";
import { getConvertibleBonds } from "./convertible";

describe("getConvertibleBonds normalization: field mapping", () => {
	it("normalizes RPT_BOND_CB_LIST rows", async () => {
		const payload = {
			result: {
				data: [
					{
						SECURITY_CODE: "113545",
						SECURITY_NAME_ABBR: "隆22转债",
						CONVERT_STOCK_CODE: "600522",
						RATING: "AA+",
						LISTING_DATE: "2026-01-10 00:00:00",
						EXPIRE_DATE: "2032-01-09 00:00:00",
						ACTUAL_ISSUE_SCALE: 50_000,
						ISSUE_PRICE: 100,
					},
				],
			},
		};
		const fetchImpl = () => Promise.resolve(Response.json(payload));
		const rows = await getConvertibleBonds(30, {
			fetchImpl: fetchImpl as typeof fetch,
		});
		expect(rows[0]).toMatchObject({
			code: "113545",
			name: "隆22转债",
			stockCode: "600522",
			rating: "AA+",
			listingDate: "2026-01-10",
			expireDate: "2032-01-09",
			issueScale: 50_000,
			issuePrice: 100,
		});
	});
});

describe("getConvertibleBonds normalization: null-safety", () => {
	it("maps missing fields to null/empty-string instead of throwing", async () => {
		const payload = {
			result: { data: [{ SECURITY_CODE: "113545" }] },
		};
		const fetchImpl = () => Promise.resolve(Response.json(payload));
		const rows = await getConvertibleBonds(30, {
			fetchImpl: fetchImpl as typeof fetch,
		});
		expect(rows[0]).toMatchObject({
			name: "",
			stockCode: "",
			rating: "",
			listingDate: "",
			expireDate: "",
			issueScale: null,
			issuePrice: null,
		});
	});
});

describe("getConvertibleBonds request URL", () => {
	it("hits the datacenter-web report endpoint sorted by LISTING_DATE desc", async () => {
		const fetchImpl = (url: string | URL | Request) => {
			const href = String(url);
			expect(href).toContain("reportName=RPT_BOND_CB_LIST");
			expect(href).toContain("sortColumns=LISTING_DATE&sortTypes=-1");
			expect(href).toContain("pageSize=30");
			return Promise.resolve(Response.json({ result: { data: [] } }));
		};
		await getConvertibleBonds(30, { fetchImpl: fetchImpl as typeof fetch });
	});
});

describe("getConvertibleBonds edge cases", () => {
	it("degrades to [] on upstream failure", async () => {
		const fetchImpl = () =>
			Promise.resolve(new Response("not found", { status: 404 }));
		expect(
			await getConvertibleBonds(30, {
				fetchImpl: fetchImpl as typeof fetch,
			})
		).toEqual([]);
	});

	it("clamps limit to the 100 max and defaults to 30", async () => {
		const OVER_MAX_LIMIT = 999;
		const fetchImpl = (url: string | URL | Request) => {
			expect(String(url)).toContain("pageSize=100");
			return Promise.resolve(Response.json({ result: { data: [] } }));
		};
		await getConvertibleBonds(OVER_MAX_LIMIT, {
			fetchImpl: fetchImpl as typeof fetch,
		});
	});
});
