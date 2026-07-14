import { describe, expect, it } from "vitest";
import { getStockBoards } from "./stock-boards";

const DIFF_ARRAY = [
	{ f12: "BK0438", f14: "食品饮料", f3: 1.23, f128: "贵州茅台" },
	{ f12: "BK0896", f14: "白酒", f3: -0.5, f128: "五粮液" },
];

const DIFF_DICT = {
	"0": { f12: "BK0438", f14: "食品饮料", f3: 1.23, f128: "贵州茅台" },
	"1": { f12: "BK0896", f14: "白酒", f3: -0.5, f128: "五粮液" },
};

function fetchImplFor(diff: unknown, sink?: { url?: string }): typeof fetch {
	return ((url: string | URL | Request, init?: RequestInit) => {
		if (sink) {
			sink.url = String(url);
		}
		expect(init?.headers).toMatchObject({
			Referer: "https://quote.eastmoney.com/",
		});
		return Promise.resolve(Response.json({ data: { diff } }));
	}) as typeof fetch;
}

describe("getStockBoards: request shape", () => {
	it("builds an SH secid (m=1) with the slist params", async () => {
		const sink: { url?: string } = {};
		await getStockBoards("600519", { fetchImpl: fetchImplFor([], sink) });
		expect(sink.url).toContain("push2.eastmoney.com/api/qt/slist/get");
		expect(sink.url).toContain("secid=1.600519");
		expect(sink.url).toContain("spt=3");
		expect(sink.url).toContain("pz=200");
		expect(sink.url).toContain("fields=f12,f14,f3,f128");
	});

	it("builds an SZ secid (m=0) and accepts suffix/prefix code forms", async () => {
		const sink: { url?: string } = {};
		await getStockBoards("000001.SZ", { fetchImpl: fetchImplFor([], sink) });
		expect(sink.url).toContain("secid=0.000001");
		await getStockBoards("SH600519", { fetchImpl: fetchImplFor([], sink) });
		expect(sink.url).toContain("secid=1.600519");
	});
});

describe("getStockBoards: diff normalization", () => {
	it("maps an array-shaped diff into boards + conceptTags", async () => {
		const out = await getStockBoards("600519", {
			fetchImpl: fetchImplFor(DIFF_ARRAY),
		});
		expect(out.total).toBe(2);
		expect(out.boards[0]).toEqual({
			name: "食品饮料",
			code: "BK0438",
			changePct: 1.23,
			leadStock: "贵州茅台",
		});
		expect(out.conceptTags).toEqual(["食品饮料", "白酒"]);
	});

	it("maps a dict-shaped diff identically", async () => {
		const out = await getStockBoards("600519", {
			fetchImpl: fetchImplFor(DIFF_DICT),
		});
		expect(out.total).toBe(2);
		expect(out.boards[1]).toMatchObject({ code: "BK0896", changePct: -0.5 });
	});
});

describe("getStockBoards: degradation", () => {
	const EMPTY = { total: 0, boards: [], conceptTags: [] };

	it("degrades to empty on HTTP failure", async () => {
		const fetchImpl = () =>
			Promise.resolve(new Response("boom", { status: 404 }));
		expect(
			await getStockBoards("600519", { fetchImpl: fetchImpl as typeof fetch })
		).toEqual(EMPTY);
	});

	it("degrades to empty on thrown fetch and on invalid code", async () => {
		const fetchImpl = () => Promise.reject(new Error("network"));
		expect(
			await getStockBoards("600519", {
				fetchImpl: fetchImpl as typeof fetch,
			})
		).toEqual(EMPTY);
		expect(await getStockBoards("not-a-code")).toEqual(EMPTY);
	});
});
