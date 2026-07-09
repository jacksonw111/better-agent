import { describe, expect, it } from "vitest";
import { getIpo } from "./ipo";

describe("getIpo normalization: field mapping", () => {
	it("normalizes RPTA_APP_IPOAPPLY rows", async () => {
		const payload = {
			result: {
				data: [
					{
						SECURITY_CODE: "301888",
						SECURITY_NAME_ABBR: "新易盛二代",
						APPLY_CODE: "301888",
						APPLY_DATE: "2026-07-10 00:00:00",
						LISTING_DATE: "2026-07-20 00:00:00",
						MARKET_TYPE_NEW: "创业板",
						ISSUE_PRICE: 25.5,
						ONLINE_APPLY_UPPER: 15_000,
						AFTER_ISSUE_PE: 32.1,
						INDUSTRY_PE_RATIO: 28.7,
					},
				],
			},
		};
		const fetchImpl = () => Promise.resolve(Response.json(payload));
		const rows = await getIpo(20, { fetchImpl: fetchImpl as typeof fetch });
		expect(rows[0]).toMatchObject({
			code: "301888",
			name: "新易盛二代",
			applyCode: "301888",
			applyDate: "2026-07-10",
			listingDate: "2026-07-20",
			market: "创业板",
			issuePrice: 25.5,
			applyUpper: 15_000,
			afterPe: 32.1,
			industryPe: 28.7,
		});
	});
});

describe("getIpo normalization: null-safety", () => {
	it("maps missing fields to null/empty-string instead of throwing", async () => {
		const payload = {
			result: { data: [{ SECURITY_CODE: "301888" }] },
		};
		const fetchImpl = () => Promise.resolve(Response.json(payload));
		const rows = await getIpo(20, { fetchImpl: fetchImpl as typeof fetch });
		expect(rows[0]).toMatchObject({
			name: "",
			applyCode: "",
			applyDate: "",
			listingDate: "",
			market: "",
			issuePrice: null,
			applyUpper: null,
			afterPe: null,
			industryPe: null,
		});
	});
});

describe("getIpo request URL", () => {
	it("hits the datacenter-web report endpoint sorted by APPLY_DATE desc", async () => {
		const fetchImpl = (url: string | URL | Request) => {
			const href = String(url);
			expect(href).toContain("reportName=RPTA_APP_IPOAPPLY");
			expect(href).toContain("sortColumns=APPLY_DATE&sortTypes=-1");
			expect(href).toContain("pageSize=20");
			return Promise.resolve(Response.json({ result: { data: [] } }));
		};
		await getIpo(20, { fetchImpl: fetchImpl as typeof fetch });
	});
});

describe("getIpo edge cases", () => {
	it("degrades to [] on upstream failure", async () => {
		const fetchImpl = () =>
			Promise.resolve(new Response("not found", { status: 404 }));
		expect(await getIpo(20, { fetchImpl: fetchImpl as typeof fetch })).toEqual(
			[]
		);
	});

	it("clamps limit to the 60 max and defaults to 20", async () => {
		const OVER_MAX_LIMIT = 999;
		const fetchImpl = (url: string | URL | Request) => {
			expect(String(url)).toContain("pageSize=60");
			return Promise.resolve(Response.json({ result: { data: [] } }));
		};
		await getIpo(OVER_MAX_LIMIT, { fetchImpl: fetchImpl as typeof fetch });
	});
});
