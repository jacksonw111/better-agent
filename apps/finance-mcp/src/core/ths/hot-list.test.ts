import { describe, expect, it } from "vitest";
import { getThsHotList } from "./hot-list";

const PAYLOAD = {
	data: {
		stock_list: [
			{
				order: 1,
				code: "600519",
				name: "贵州茅台",
				rate: "812.5",
				rise_and_fall: "2.13",
				hot_rank_chg: 3,
				tag: { concept_tag: ["白酒", "消费"], popularity_tag: "连续上榜" },
			},
			{
				order: 2,
				code: "000001",
				name: "平安银行",
				rate: 501,
				rise_and_fall: -0.5,
				hot_rank_chg: -2,
			},
		],
	},
};

function fetchImplFor(expectedType: string): typeof fetch {
	return ((url: string | URL | Request, init?: RequestInit) => {
		const href = String(url);
		expect(href).toContain(
			"dq.10jqka.com.cn/fuyao/hot_list_data/out/hot_list/v1/stock"
		);
		expect(href).toContain("stock_type=a");
		expect(href).toContain(`type=${expectedType}`);
		expect(href).toContain("list_type=normal");
		expect(init?.method).toBeUndefined();
		return Promise.resolve(Response.json(PAYLOAD));
	}) as typeof fetch;
}

describe("getThsHotList: happy path", () => {
	it("maps stock_list rows (string heat coerced, tag defaults)", async () => {
		const rows = await getThsHotList("hour", 20, {
			fetchImpl: fetchImplFor("hour"),
		});
		expect(rows).toHaveLength(2);
		expect(rows[0]).toEqual({
			rank: 1,
			code: "600519",
			name: "贵州茅台",
			heat: 812.5,
			pct: 2.13,
			rankChange: 3,
			concepts: ["白酒", "消费"],
			tag: "连续上榜",
		});
		expect(rows[1]).toMatchObject({ concepts: [], tag: "", rankChange: -2 });
	});

	it("sends period=day in the URL and slices to limit", async () => {
		const rows = await getThsHotList("day", 1, {
			fetchImpl: fetchImplFor("day"),
		});
		expect(rows).toHaveLength(1);
		expect(rows[0]?.code).toBe("600519");
	});
});

describe("getThsHotList: degradation", () => {
	it("returns [] on non-OK status", async () => {
		const fetchImpl = (() =>
			Promise.resolve(new Response("boom", { status: 500 }))) as typeof fetch;
		expect(await getThsHotList("hour", 20, { fetchImpl })).toEqual([]);
	});

	it("returns [] when fetch throws", async () => {
		const fetchImpl = (() =>
			Promise.reject(new Error("network down"))) as typeof fetch;
		expect(await getThsHotList("hour", 20, { fetchImpl })).toEqual([]);
	});

	it("returns [] when stock_list is missing", async () => {
		const fetchImpl = (() =>
			Promise.resolve(Response.json({ data: {} }))) as typeof fetch;
		expect(await getThsHotList("hour", 20, { fetchImpl })).toEqual([]);
	});
});
