import { describe, expect, it } from "vitest";
import { getSectorConstituents, getSectorList } from "./sector";

const ROW = {
	f12: "BK0477",
	f14: "银行",
	f2: 12.3,
	f3: 1.5,
	f62: 123_456,
	f128: "601398",
	f136: 2.1,
};

describe("getSectorList", () => {
	it("parses diff as an array", async () => {
		const payload = { data: { diff: [ROW] } };
		const fetchImpl = () => Promise.resolve(Response.json(payload));
		const rows = await getSectorList("industry", {
			fetchImpl: fetchImpl as typeof fetch,
		});
		expect(rows).toEqual([
			{
				code: "BK0477",
				name: "银行",
				price: 12.3,
				changePct: 1.5,
				mainNet: 123_456,
				leadStockCode: "601398",
				leadStockChangePct: 2.1,
			},
		]);
	});

	it("parses diff as an object keyed by index", async () => {
		const payload = { data: { diff: { 0: ROW } } };
		const fetchImpl = () => Promise.resolve(Response.json(payload));
		const rows = await getSectorList("concept", {
			fetchImpl: fetchImpl as typeof fetch,
		});
		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({ code: "BK0477", name: "银行" });
	});

	it("degrades to [] on non-OK response", async () => {
		const fetchImpl = () => Promise.resolve(new Response("", { status: 500 }));
		const rows = await getSectorList("industry", {
			fetchImpl: fetchImpl as typeof fetch,
		});
		expect(rows).toEqual([]);
	});

	it("degrades to [] when diff is missing", async () => {
		const fetchImpl = () => Promise.resolve(Response.json({ data: {} }));
		const rows = await getSectorList("industry", {
			fetchImpl: fetchImpl as typeof fetch,
		});
		expect(rows).toEqual([]);
	});
});

describe("getSectorConstituents", () => {
	it("maps member stocks", async () => {
		const payload = {
			data: {
				diff: [{ f12: "601398", f14: "工商银行", f2: 5.6, f3: -0.4 }],
			},
		};
		const fetchImpl = () => Promise.resolve(Response.json(payload));
		const rows = await getSectorConstituents("BK0477", {
			fetchImpl: fetchImpl as typeof fetch,
		});
		expect(rows).toEqual([
			{ code: "601398", name: "工商银行", price: 5.6, changePct: -0.4 },
		]);
	});

	it("degrades to [] on fetch error", async () => {
		const fetchImpl = () => Promise.reject(new Error("network down"));
		const rows = await getSectorConstituents("BK0477", {
			fetchImpl: fetchImpl as typeof fetch,
		});
		expect(rows).toEqual([]);
	});
});
