import { describe, expect, it } from "vitest";
import { getSharePledge, parsePledgeRows } from "./pledge";

const RAW = {
	result: {
		data: [
			{
				TRADE_DATE: "2024-04-30 00:00:00",
				SECURITY_CODE: "000002",
				SECURITY_NAME_ABBR: "万科A",
				PLEDGE_RATIO: 1.23,
				PLEDGE_DEAL_NUM: 4,
				PLEDGE_MARKET_CAP: 88_923.55,
				REPURCHASE_BALANCE: 1000,
				INDUSTRY: "房地产开发",
			},
		],
	},
};

describe("parsePledgeRows", () => {
	it("maps report fields, trimming the date to YYYY-MM-DD", () => {
		expect(parsePledgeRows(RAW)).toEqual([
			{
				date: "2024-04-30",
				code: "000002",
				name: "万科A",
				pledgeRatio: 1.23,
				pledgeDealNum: 4,
				pledgeMarketCap: 88_923.55,
				repurchaseBalance: 1000,
				industry: "房地产开发",
			},
		]);
	});

	it("returns [] for an empty/malformed payload", () => {
		expect(parsePledgeRows({})).toEqual([]);
		expect(parsePledgeRows({ result: null })).toEqual([]);
	});
});

describe("getSharePledge", () => {
	it("filters by parsed code, sorts by date desc, clamps the page size", async () => {
		let seen = "";
		const fetchImpl = ((url: string | URL | Request) => {
			seen = String(url);
			return Promise.resolve(Response.json(RAW));
		}) as typeof fetch;
		const rows = await getSharePledge("000002.SZ", 999, { fetchImpl });
		const parsed = new URL(seen);
		expect(parsed.searchParams.get("reportName")).toBe("RPT_CSDC_LIST");
		expect(parsed.searchParams.get("filter")).toBe('(SECURITY_CODE="000002")');
		expect(parsed.searchParams.get("sortColumns")).toBe("TRADE_DATE");
		expect(parsed.searchParams.get("sortTypes")).toBe("-1");
		expect(parsed.searchParams.get("pageSize")).toBe("60"); // clamped to MAX
		expect(rows[0]).toMatchObject({ code: "000002", pledgeRatio: 1.23 });
	});

	it("degrades to [] on HTTP 500", async () => {
		const fetchImpl = (() =>
			Promise.resolve(new Response("boom", { status: 500 }))) as typeof fetch;
		expect(await getSharePledge("000002.SZ", 12, { fetchImpl })).toEqual([]);
	});
});
