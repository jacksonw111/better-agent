import { describe, expect, it } from "vitest";
import { getPreannounce } from "./preannounce";

describe("getPreannounce normalization: field mapping", () => {
	it("normalizes RPT_PUBLIC_OP_NEWPREDICT rows", async () => {
		const payload = {
			result: {
				data: [
					{
						NOTICE_DATE: "2026-07-08 00:00:00",
						REPORT_DATE: "2026-06-30 00:00:00",
						SECURITY_CODE: "600519",
						SECURITY_NAME_ABBR: "贵州茅台",
						PREDICT_TYPE: "预增",
						ADD_AMP_LOWER: 10,
						ADD_AMP_UPPER: 20,
						PREDICT_CONTENT: "预计净利润同比增长10%-20%",
						CHANGE_REASON_EXPLAIN: "主营业务收入增长",
					},
				],
			},
		};
		const fetchImpl = () => Promise.resolve(Response.json(payload));
		const rows = await getPreannounce(undefined, 20, {
			fetchImpl: fetchImpl as typeof fetch,
		});
		expect(rows[0]).toMatchObject({
			noticeDate: "2026-07-08",
			reportDate: "2026-06-30",
			code: "600519",
			name: "贵州茅台",
			type: "预增",
			changeLower: 10,
			changeUpper: 20,
			content: "预计净利润同比增长10%-20%",
			reason: "主营业务收入增长",
		});
	});
});

describe("getPreannounce normalization: null-safety", () => {
	it("maps missing fields to null/empty-string instead of throwing", async () => {
		const payload = {
			result: { data: [{ NOTICE_DATE: "2026-07-08 00:00:00" }] },
		};
		const fetchImpl = () => Promise.resolve(Response.json(payload));
		const rows = await getPreannounce(undefined, 20, {
			fetchImpl: fetchImpl as typeof fetch,
		});
		expect(rows[0]).toMatchObject({
			code: "",
			name: "",
			type: "",
			changeLower: null,
			changeUpper: null,
			content: "",
			reason: "",
		});
	});
});

describe("getPreannounce request URL", () => {
	it("omits the SECURITY_CODE filter when no symbol is given", async () => {
		const fetchImpl = (url: string | URL | Request) => {
			const href = String(url);
			expect(href).toContain("reportName=RPT_PUBLIC_OP_NEWPREDICT");
			expect(href).not.toContain("SECURITY_CODE");
			expect(href).toContain("sortColumns=NOTICE_DATE&sortTypes=-1");
			return Promise.resolve(Response.json({ result: { data: [] } }));
		};
		await getPreannounce(undefined, 20, {
			fetchImpl: fetchImpl as typeof fetch,
		});
	});

	it("filters by SECURITY_CODE when a symbol is given", async () => {
		const fetchImpl = (url: string | URL | Request) => {
			expect(String(url)).toContain('filter=(SECURITY_CODE="600519")');
			return Promise.resolve(Response.json({ result: { data: [] } }));
		};
		await getPreannounce("600519.SH", 20, {
			fetchImpl: fetchImpl as typeof fetch,
		});
	});
});

describe("getPreannounce edge cases", () => {
	it("degrades to [] on upstream failure", async () => {
		const fetchImpl = () =>
			Promise.resolve(new Response("not found", { status: 404 }));
		expect(
			await getPreannounce(undefined, 20, {
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
		await getPreannounce(undefined, OVER_MAX_LIMIT, {
			fetchImpl: fetchImpl as typeof fetch,
		});
	});
});
