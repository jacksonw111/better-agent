import { describe, expect, it } from "vitest";
import {
	formatPoolTime,
	getLimitUpPool,
	getLimitUpSentiment,
	parseLimitUpPoolItem,
	type RawPoolItem,
} from "./limit-up";

const ZT_ITEM: RawPoolItem = {
	c: "600519",
	n: "贵州茅台",
	p: 16_800,
	zdp: 10.012,
	amount: 123_456_789,
	ltsz: 2_000_000_000,
	hs: 3.456,
	lbc: 3,
	fbt: 92_500,
	lbt: 143_000,
	fund: 50_000_000,
	zbc: 1,
	hybk: "白酒",
	zttj: { days: 5, ct: 3 },
};

function poolFetch(pools: Record<string, RawPoolItem[] | null>): typeof fetch {
	return ((url: string | URL | Request, init?: RequestInit) => {
		const href = String(url);
		expect(init?.headers).toMatchObject({
			Referer: "https://quote.eastmoney.com/",
		});
		for (const [endpoint, pool] of Object.entries(pools)) {
			if (href.includes(endpoint)) {
				return Promise.resolve(
					Response.json({ data: pool === null ? null : { pool } })
				);
			}
		}
		throw new Error(`unexpected URL in test: ${href}`);
	}) as typeof fetch;
}

describe("formatPoolTime", () => {
	it("formats packed HHMMSS integers, zero-padding the hour", () => {
		expect(formatPoolTime(92_500)).toBe("09:25:00");
		expect(formatPoolTime(143_057)).toBe("14:30:57");
	});
});

describe("parseLimitUpPoolItem", () => {
	it("maps a zt item: ÷1000 price, rounded pct, times, zt_stat", () => {
		expect(parseLimitUpPoolItem("zt", ZT_ITEM)).toEqual({
			code: "600519",
			name: "贵州茅台",
			price: 16.8,
			pct: 10.01,
			amount: 123_456_789,
			floatCap: 2_000_000_000,
			turnover: 3.46,
			limitDays: 3,
			firstSeal: "09:25:00",
			lastSeal: "14:30:00",
			sealFund: 50_000_000,
			breakTimes: 1,
			industry: "白酒",
			ztStat: "5天3板",
		});
	});

	it("maps a zb item with ÷1000 limitPrice, amplitude and speed", () => {
		const row = parseLimitUpPoolItem("zb", {
			...ZT_ITEM,
			ztp: 16_900,
			zf: 5.678,
			zs: 1.234,
		});
		expect(row).toMatchObject({
			limitPrice: 16.9,
			amplitude: 5.68,
			speed: 1.23,
			firstSeal: "09:25:00",
			breakTimes: 1,
		});
		expect(row.limitDays).toBeUndefined();
	});
});

describe("getLimitUpPool", () => {
	it("requests the right endpoint/params and maps the pool", async () => {
		let seen = "";
		const fetchImpl = ((url: string | URL | Request) => {
			seen = String(url);
			return Promise.resolve(Response.json({ data: { pool: [ZT_ITEM] } }));
		}) as typeof fetch;
		const rows = await getLimitUpPool("zt", "20260626", { fetchImpl });
		const parsed = new URL(seen);
		expect(parsed.host).toBe("push2ex.eastmoney.com");
		expect(parsed.pathname).toBe("/getTopicZTPool");
		expect(parsed.searchParams.get("ut")).toBe(
			"7eea3edcaed734bea9cbfc24409ed989"
		);
		expect(parsed.searchParams.get("dpt")).toBe("wz.ztzt");
		expect(parsed.searchParams.get("Pageindex")).toBe("0");
		expect(parsed.searchParams.get("pagesize")).toBe("10000");
		expect(parsed.searchParams.get("sort")).toBe("fbt:asc");
		expect(parsed.searchParams.get("date")).toBe("20260626");
		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({ code: "600519", price: 16.8 });
	});

	it("uses the per-kind endpoint and sort", async () => {
		let seen = "";
		const fetchImpl = ((url: string | URL | Request) => {
			seen = String(url);
			return Promise.resolve(Response.json({ data: { pool: [] } }));
		}) as typeof fetch;
		await getLimitUpPool("dt", "20260626", { fetchImpl });
		const parsed = new URL(seen);
		expect(parsed.pathname).toBe("/getTopicDTPool");
		expect(parsed.searchParams.get("sort")).toBe("fund:asc");
	});
});

describe("getLimitUpPool: degradation", () => {
	it("degrades to [] on HTTP 500", async () => {
		const fetchImpl = (() =>
			Promise.resolve(new Response("boom", { status: 500 }))) as typeof fetch;
		expect(await getLimitUpPool("zt", "20260626", { fetchImpl })).toEqual([]);
	});

	it("degrades to [] on invalid JSON", async () => {
		const fetchImpl = (() =>
			Promise.resolve(new Response("<html>oops</html>"))) as typeof fetch;
		expect(await getLimitUpPool("zb", "20260626", { fetchImpl })).toEqual([]);
	});

	it("degrades to [] when data is null (non-trading day)", async () => {
		const fetchImpl = (() =>
			Promise.resolve(Response.json({ data: null }))) as typeof fetch;
		expect(await getLimitUpPool("yzt", "20260626", { fetchImpl })).toEqual([]);
	});
});

describe("getLimitUpSentiment", () => {
	it("computes counts, break rate, max height and ladder", async () => {
		const fetchImpl = poolFetch({
			getTopicZTPool: [
				{ ...ZT_ITEM, lbc: 1 },
				{ ...ZT_ITEM, lbc: 1 },
				{ ...ZT_ITEM, lbc: 2 },
			],
			getTopicZBPool: [ZT_ITEM],
			getTopicDTPool: null,
		});
		const s = await getLimitUpSentiment("20260626", { fetchImpl });
		expect(s).toEqual({
			date: "20260626",
			ztCount: 3,
			zbCount: 1,
			dtCount: 0,
			breakRatePct: 25,
			maxHeight: 2,
			ladder: { "1": 2, "2": 1 },
		});
	});

	it("reports zero break rate when zt+zb is empty", async () => {
		const fetchImpl = poolFetch({
			getTopicZTPool: null,
			getTopicZBPool: null,
			getTopicDTPool: null,
		});
		const s = await getLimitUpSentiment("20260101", { fetchImpl });
		expect(s.breakRatePct).toBe(0);
		expect(s.maxHeight).toBe(0);
		expect(s.ladder).toEqual({});
	});
});
