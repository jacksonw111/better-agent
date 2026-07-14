import { describe, expect, it } from "vitest";
import {
	formatCnClockTime,
	getLimitUpReasons,
	parseLimitUpReasonItem,
	type RawThsInfo,
} from "./limit-up-reasons";

// 2026-06-26 09:25:00 UTC+8 == 2026-06-26 01:25:00 UTC.
const FIRST_LIMIT_UP_TS = Date.UTC(2026, 5, 26, 1, 25, 0) / 1000;

const INFO_ITEM: RawThsInfo = {
	code: "002514",
	name: "宝馨科技",
	latest: 7.89,
	change_rate: 10.04,
	reason_type: "固态电池+光伏",
	limit_up_type: "换手板",
	limit_up_suc_rate: 0.8571,
	open_num: 2,
	order_amount: 123_450_000,
	high_days: "3天2板",
	first_limit_up_time: FIRST_LIMIT_UP_TS,
	is_again_limit: 1,
};

describe("formatCnClockTime", () => {
	it("formats unix seconds as UTC+8 wall-clock", () => {
		expect(formatCnClockTime(FIRST_LIMIT_UP_TS)).toBe("09:25:00");
		// 00:00 UTC == 08:00 in UTC+8.
		expect(formatCnClockTime(Date.UTC(2026, 5, 26, 0, 0, 0) / 1000)).toBe(
			"08:00:00"
		);
		// UTC+8 rolls past midnight relative to UTC.
		expect(formatCnClockTime(Date.UTC(2026, 5, 26, 16, 0, 1) / 1000)).toBe(
			"00:00:01"
		);
	});
});

describe("parseLimitUpReasonItem", () => {
	it("maps every field including the seconds-timestamp firstTime", () => {
		expect(parseLimitUpReasonItem(INFO_ITEM)).toEqual({
			code: "002514",
			name: "宝馨科技",
			price: 7.89,
			pct: 10.04,
			reason: "固态电池+光伏",
			boardType: "换手板",
			sealRate: 0.8571,
			breakTimes: 2,
			sealAmount: 123_450_000,
			highDays: "3天2板",
			firstTime: "09:25:00",
			isAgain: 1,
		});
	});

	it("degrades missing fields to blanks/zeros", () => {
		expect(parseLimitUpReasonItem({})).toEqual({
			code: "",
			name: "",
			price: 0,
			pct: 0,
			reason: "",
			boardType: "",
			sealRate: 0,
			breakTimes: 0,
			sealAmount: 0,
			highDays: "",
			firstTime: "",
			isAgain: 0,
		});
	});
});

describe("getLimitUpReasons", () => {
	it("requests the documented params and maps info rows", async () => {
		let seen = "";
		const fetchImpl = ((url: string | URL | Request, init?: RequestInit) => {
			seen = String(url);
			expect(init?.headers).toMatchObject({
				"User-Agent": expect.stringContaining("Mozilla/5.0"),
			});
			return Promise.resolve(Response.json({ data: { info: [INFO_ITEM] } }));
		}) as typeof fetch;
		const rows = await getLimitUpReasons("20260626", { fetchImpl });
		const parsed = new URL(seen);
		expect(parsed.host).toBe("data.10jqka.com.cn");
		expect(parsed.pathname).toBe("/dataapi/limit_up/limit_up_pool");
		expect(parsed.searchParams.get("page")).toBe("1");
		expect(parsed.searchParams.get("limit")).toBe("200");
		expect(parsed.searchParams.get("field")).toContain("199112,10,9001");
		expect(parsed.searchParams.get("filter")).toBe("HS,GEM2STAR");
		expect(parsed.searchParams.get("order_field")).toBe("330324");
		expect(parsed.searchParams.get("order_type")).toBe("0");
		expect(parsed.searchParams.get("date")).toBe("20260626");
		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({ code: "002514", firstTime: "09:25:00" });
	});

	it("honours an explicit limit", async () => {
		let seen = "";
		const fetchImpl = ((url: string | URL | Request) => {
			seen = String(url);
			return Promise.resolve(Response.json({ data: { info: [] } }));
		}) as typeof fetch;
		await getLimitUpReasons("20260626", { fetchImpl, limit: 50 });
		expect(new URL(seen).searchParams.get("limit")).toBe("50");
	});
});

describe("getLimitUpReasons: degradation", () => {
	it("degrades to [] on HTTP 500", async () => {
		const fetchImpl = (() =>
			Promise.resolve(new Response("boom", { status: 500 }))) as typeof fetch;
		expect(await getLimitUpReasons("20260626", { fetchImpl })).toEqual([]);
	});

	it("degrades to [] on invalid JSON", async () => {
		const fetchImpl = (() =>
			Promise.resolve(new Response("not-json"))) as typeof fetch;
		expect(await getLimitUpReasons("20260626", { fetchImpl })).toEqual([]);
	});

	it("degrades to [] when data is null", async () => {
		const fetchImpl = (() =>
			Promise.resolve(Response.json({ data: null }))) as typeof fetch;
		expect(await getLimitUpReasons("20260626", { fetchImpl })).toEqual([]);
	});
});
