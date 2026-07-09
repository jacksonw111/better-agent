import { describe, expect, it } from "vitest";
import { getSuspension } from "./suspension";

describe("getSuspension normalization", () => {
	it("normalizes RPT_CUSTOM_SUSPEND_DATA_INTERFACE rows", async () => {
		const payload = {
			result: {
				data: [
					{
						SECURITY_CODE: "600519",
						SECURITY_NAME_ABBR: "贵州茅台",
						SUSPEND_START_TIME: "2026-07-08 09:30:00",
						SUSPEND_END_TIME: "2026-07-09 09:30:00",
						SUSPEND_EXPIRE: "1个交易日",
						SUSPEND_REASON: "重大事项",
						PREDICT_RESUME_DATE: "2026-07-09 00:00:00",
						TRADE_MARKET: "上海证券交易所",
					},
				],
			},
		};
		const fetchImpl = () => Promise.resolve(Response.json(payload));
		const rows = await getSuspension(30, {
			fetchImpl: fetchImpl as typeof fetch,
		});
		expect(rows[0]).toMatchObject({
			code: "600519",
			name: "贵州茅台",
			suspendStart: "2026-07-08",
			suspendEnd: "2026-07-09",
			expire: "1个交易日",
			reason: "重大事项",
			predictResume: "2026-07-09",
		});
	});

	it("maps missing optional fields to null/empty-string instead of throwing", async () => {
		const payload = {
			result: { data: [{ SUSPEND_START_TIME: "2026-07-08 09:30:00" }] },
		};
		const fetchImpl = () => Promise.resolve(Response.json(payload));
		const rows = await getSuspension(30, {
			fetchImpl: fetchImpl as typeof fetch,
		});
		expect(rows[0]).toMatchObject({
			code: "",
			name: "",
			suspendEnd: null,
			expire: null,
			reason: null,
			predictResume: null,
		});
	});
});

describe("getSuspension request URL", () => {
	it("filter contains DATETIME (from opts.now) and MARKET, properly encoded", async () => {
		const fixedNow = Date.parse("2026-07-09T00:00:00Z");
		const fetchImpl = (url: string | URL | Request) => {
			const parsed = new URL(String(url));
			expect(parsed.searchParams.get("reportName")).toBe(
				"RPT_CUSTOM_SUSPEND_DATA_INTERFACE"
			);
			const filter = parsed.searchParams.get("filter") ?? "";
			expect(filter).toContain('MARKET="全部"');
			expect(filter).toContain("DATETIME='2026-07-09'");
			expect(parsed.searchParams.get("sortColumns")).toBe("SUSPEND_START_TIME");
			expect(parsed.searchParams.get("sortTypes")).toBe("-1");
			return Promise.resolve(Response.json({ result: { data: [] } }));
		};
		await getSuspension(30, {
			fetchImpl: fetchImpl as typeof fetch,
			now: fixedNow,
		});
	});

	it("defaults DATETIME to the current day when opts.now is omitted", async () => {
		const today = new Date().toISOString().slice(0, 10);
		const fetchImpl = (url: string | URL | Request) => {
			const parsed = new URL(String(url));
			const filter = parsed.searchParams.get("filter") ?? "";
			expect(filter).toContain(`DATETIME='${today}'`);
			return Promise.resolve(Response.json({ result: { data: [] } }));
		};
		await getSuspension(30, { fetchImpl: fetchImpl as typeof fetch });
	});
});

describe("getSuspension edge cases", () => {
	it("degrades to [] on upstream failure", async () => {
		const fetchImpl = () =>
			Promise.resolve(new Response("not found", { status: 404 }));
		expect(
			await getSuspension(30, { fetchImpl: fetchImpl as typeof fetch })
		).toEqual([]);
	});

	it("clamps limit to the 100 max and defaults to 30", async () => {
		const OVER_MAX_LIMIT = 999;
		const fetchImpl = (url: string | URL | Request) => {
			const parsed = new URL(String(url));
			expect(parsed.searchParams.get("pageSize")).toBe("100");
			return Promise.resolve(Response.json({ result: { data: [] } }));
		};
		await getSuspension(OVER_MAX_LIMIT, {
			fetchImpl: fetchImpl as typeof fetch,
		});
	});
});
