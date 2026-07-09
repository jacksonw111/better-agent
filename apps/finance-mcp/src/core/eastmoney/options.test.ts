import { describe, expect, it } from "vitest";
import { getOptionChain } from "./options";

const CALL_ROW = {
	f12: "10007890",
	f14: "300ETF购7月4000",
	f2: 0.1234,
	f3: 5.67,
	f108: 12_345,
	f152: 2,
};

const PUT_ROW = {
	f12: "10007891",
	f14: "300ETF沽7月3800",
	f2: 0.0567,
	f3: -3.21,
	f108: 6789,
	f152: 1,
};

describe("getOptionChain normalization", () => {
	it("maps call and put rows with kind + strike parsed from the name", async () => {
		const payload = { data: { diff: [CALL_ROW, PUT_ROW] } };
		const fetchImpl = () => Promise.resolve(Response.json(payload));
		const rows = await getOptionChain("300etf", {
			fetchImpl: fetchImpl as typeof fetch,
		});
		expect(rows).toEqual([
			{
				code: "10007890",
				name: "300ETF购7月4000",
				last: 0.1234,
				changePct: 5.67,
				volume: 12_345,
				kind: "call",
				strike: 4.0,
			},
			{
				code: "10007891",
				name: "300ETF沽7月3800",
				last: 0.0567,
				changePct: -3.21,
				volume: 6789,
				kind: "put",
				strike: 3.8,
			},
		]);
	});

	it("parses a diff object keyed by index", async () => {
		const payload = { data: { diff: { 0: CALL_ROW } } };
		const fetchImpl = () => Promise.resolve(Response.json(payload));
		const rows = await getOptionChain("300etf", {
			fetchImpl: fetchImpl as typeof fetch,
		});
		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({ kind: "call", strike: 4.0 });
	});

	it("maps strike to null when the name has no digits", async () => {
		const row = { ...CALL_ROW, f14: "ETF购认购合约" };
		const payload = { data: { diff: [row] } };
		const fetchImpl = () => Promise.resolve(Response.json(payload));
		const rows = await getOptionChain("300etf", {
			fetchImpl: fetchImpl as typeof fetch,
		});
		expect(rows[0]?.strike).toBeNull();
	});
});

describe("getOptionChain underlying -> secid mapping", () => {
	it("defaults to 300etf (1.510300) when underlying is omitted", async () => {
		const fetchImpl = (url: string | URL | Request) => {
			expect(String(url)).toContain("secid=1.510300");
			return Promise.resolve(Response.json({ data: { diff: [] } }));
		};
		await getOptionChain(undefined, { fetchImpl: fetchImpl as typeof fetch });
	});

	it("maps 50etf -> secid 1.510050", async () => {
		const fetchImpl = (url: string | URL | Request) => {
			expect(String(url)).toContain("secid=1.510050");
			return Promise.resolve(Response.json({ data: { diff: [] } }));
		};
		await getOptionChain("50etf", { fetchImpl: fetchImpl as typeof fetch });
	});

	it("maps 500etf -> secid 1.510500", async () => {
		const fetchImpl = (url: string | URL | Request) => {
			expect(String(url)).toContain("secid=1.510500");
			return Promise.resolve(Response.json({ data: { diff: [] } }));
		};
		await getOptionChain("500etf", { fetchImpl: fetchImpl as typeof fetch });
	});

	it("uses the slist/get endpoint, not clist", async () => {
		const fetchImpl = (url: string | URL | Request) => {
			expect(String(url)).toContain("/api/qt/slist/get");
			return Promise.resolve(Response.json({ data: { diff: [] } }));
		};
		await getOptionChain("300etf", { fetchImpl: fetchImpl as typeof fetch });
	});
});

describe("getOptionChain edge cases", () => {
	it("degrades to [] on non-OK response", async () => {
		const fetchImpl = () => Promise.resolve(new Response("", { status: 500 }));
		expect(
			await getOptionChain("300etf", { fetchImpl: fetchImpl as typeof fetch })
		).toEqual([]);
	});

	it("degrades to [] on fetch error", async () => {
		const fetchImpl = () => Promise.reject(new Error("network down"));
		expect(
			await getOptionChain("300etf", { fetchImpl: fetchImpl as typeof fetch })
		).toEqual([]);
	});
});
