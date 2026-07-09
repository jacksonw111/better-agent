import { describe, expect, it } from "vitest";
import { getEtfList } from "./etf";

const ROW = {
	f12: "510300",
	f14: "沪深300ETF",
	f2: 3.987,
	f3: 1.05,
	f5: 1_234_567,
	f6: 456_789_012,
	f8: 2.34,
};

describe("getEtfList normalization", () => {
	it("maps a diff array", async () => {
		const payload = { data: { diff: [ROW] } };
		const fetchImpl = () => Promise.resolve(Response.json(payload));
		const rows = await getEtfList(30, { fetchImpl: fetchImpl as typeof fetch });
		expect(rows).toEqual([
			{
				code: "510300",
				name: "沪深300ETF",
				price: 3.987,
				changePct: 1.05,
				volume: 1_234_567,
				turnover: 456_789_012,
				turnoverRate: 2.34,
			},
		]);
	});

	it("maps a diff object keyed by index", async () => {
		const payload = { data: { diff: { 0: ROW } } };
		const fetchImpl = () => Promise.resolve(Response.json(payload));
		const rows = await getEtfList(30, { fetchImpl: fetchImpl as typeof fetch });
		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({ code: "510300", name: "沪深300ETF" });
	});

	it("maps missing numeric fields to 0", async () => {
		const payload = { data: { diff: [{ f12: "510300", f14: "沪深300ETF" }] } };
		const fetchImpl = () => Promise.resolve(Response.json(payload));
		const rows = await getEtfList(30, { fetchImpl: fetchImpl as typeof fetch });
		expect(rows[0]).toMatchObject({
			price: 0,
			changePct: 0,
			volume: 0,
			turnover: 0,
			turnoverRate: 0,
		});
	});
});

describe("getEtfList request URL", () => {
	it("uses the push2 mirror host with the all-ETF board fs", async () => {
		const fetchImpl = (url: string | URL | Request) => {
			const href = String(url);
			expect(href).toContain("https://1.push2.eastmoney.com/api/qt/clist/get");
			expect(href).toContain("fs=b:MK0021,b:MK0022,b:MK0023,b:MK0024");
			expect(href).toContain("pz=30");
			return Promise.resolve(Response.json({ data: { diff: [] } }));
		};
		await getEtfList(30, { fetchImpl: fetchImpl as typeof fetch });
	});
});

describe("getEtfList edge cases", () => {
	it("degrades to [] on non-OK response", async () => {
		const fetchImpl = () => Promise.resolve(new Response("", { status: 500 }));
		expect(
			await getEtfList(30, { fetchImpl: fetchImpl as typeof fetch })
		).toEqual([]);
	});

	it("degrades to [] on fetch error", async () => {
		const fetchImpl = () => Promise.reject(new Error("network down"));
		expect(
			await getEtfList(30, { fetchImpl: fetchImpl as typeof fetch })
		).toEqual([]);
	});
});
