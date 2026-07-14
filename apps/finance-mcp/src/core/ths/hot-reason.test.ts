import { describe, expect, it } from "vitest";
import { getStrongStocks } from "./hot-reason";

const PAYLOAD = {
	errocode: 0,
	data: [
		{
			code: "300750",
			name: "宁德时代",
			reason: "固态电池+储能",
			close: "215.30",
			zhangfu: "6.82",
			huanshou: "3.41",
			chengjiaoe: "8123456789",
			ddejingliang: "0.12",
			market: "深",
		},
	],
};

function fetchImplFor(): typeof fetch {
	return ((url: string | URL | Request, init?: RequestInit) => {
		const href = String(url);
		expect(href).toBe(
			"http://zx.10jqka.com.cn/event/api/getharden/date/2026-05-09/orderby/date/orderway/desc/charset/GBK/"
		);
		expect(init?.headers).toMatchObject({
			"User-Agent": expect.stringContaining("Mozilla/5.0"),
		});
		return Promise.resolve(Response.json(PAYLOAD));
	}) as typeof fetch;
}

describe("getStrongStocks: happy path", () => {
	it("maps rows with numeric coercion of string fields", async () => {
		const rows = await getStrongStocks("2026-05-09", {
			fetchImpl: fetchImplFor(),
		});
		expect(rows).toHaveLength(1);
		expect(rows[0]).toEqual({
			code: "300750",
			name: "宁德时代",
			reason: "固态电池+储能",
			close: 215.3,
			changePct: 6.82,
			turnoverPct: 3.41,
			amount: 8_123_456_789,
			bigOrderNet: 0.12,
			market: "深",
		});
	});
});

describe("getStrongStocks: degradation", () => {
	it("returns [] when errocode is non-zero", async () => {
		const fetchImpl = (() =>
			Promise.resolve(
				Response.json({ errocode: 1, errormsg: "no data" })
			)) as typeof fetch;
		expect(await getStrongStocks("2026-05-09", { fetchImpl })).toEqual([]);
	});

	it("returns [] on non-OK status", async () => {
		const fetchImpl = (() =>
			Promise.resolve(new Response("boom", { status: 500 }))) as typeof fetch;
		expect(await getStrongStocks("2026-05-09", { fetchImpl })).toEqual([]);
	});

	it("returns [] when fetch throws", async () => {
		const fetchImpl = (() =>
			Promise.reject(new Error("network down"))) as typeof fetch;
		expect(await getStrongStocks("2026-05-09", { fetchImpl })).toEqual([]);
	});
});
