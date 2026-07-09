import { describe, expect, it } from "vitest";
import { getIndexWeights } from "./index-weights";

const ROW = {
	SECURITY_CODE: "600519",
	SECURITY_NAME_ABBR: "贵州茅台",
	WEIGHT: 5.12,
	CLOSE_PRICE: 1688.0,
	CHANGE_RATE: 1.23,
	INDUSTRY: "食品饮料",
	PE: 28.5,
	ROE: 32.1,
};

describe("getIndexWeights normalization: field mapping", () => {
	it("maps RPT_INDEX_TS_COMPONENT rows for the hs300 default", async () => {
		const payload = { result: { data: [ROW] } };
		const fetchImpl = () => Promise.resolve(Response.json(payload));
		const rows = await getIndexWeights(undefined, {
			fetchImpl: fetchImpl as typeof fetch,
		});
		expect(rows).toEqual([
			{
				code: "600519",
				name: "贵州茅台",
				weight: 5.12,
				closePrice: 1688.0,
				changePct: 1.23,
				industry: "食品饮料",
				pe: 28.5,
				roe: 32.1,
			},
		]);
	});
});

describe("getIndexWeights normalization: null-safety", () => {
	it("maps missing fields to null/empty-string instead of throwing", async () => {
		const payload = { result: { data: [{ SECURITY_CODE: "600519" }] } };
		const fetchImpl = () => Promise.resolve(Response.json(payload));
		const rows = await getIndexWeights(undefined, {
			fetchImpl: fetchImpl as typeof fetch,
		});
		expect(rows[0]).toMatchObject({
			code: "600519",
			name: "",
			weight: null,
			closePrice: null,
			changePct: null,
			industry: "",
			pe: null,
			roe: null,
		});
	});
});

describe("getIndexWeights index -> TYPE mapping", () => {
	it("defaults to TYPE=1 (hs300) when index is omitted", async () => {
		const fetchImpl = (url: string | URL | Request) => {
			expect(String(url)).toContain('filter=(TYPE="1")');
			return Promise.resolve(Response.json({ result: { data: [] } }));
		};
		await getIndexWeights(undefined, { fetchImpl: fetchImpl as typeof fetch });
	});

	it("maps sz50 -> TYPE=2", async () => {
		const fetchImpl = (url: string | URL | Request) => {
			expect(String(url)).toContain('filter=(TYPE="2")');
			return Promise.resolve(Response.json({ result: { data: [] } }));
		};
		await getIndexWeights("sz50", { fetchImpl: fetchImpl as typeof fetch });
	});

	it("maps star50 -> TYPE=4", async () => {
		const fetchImpl = (url: string | URL | Request) => {
			expect(String(url)).toContain('filter=(TYPE="4")');
			return Promise.resolve(Response.json({ result: { data: [] } }));
		};
		await getIndexWeights("star50", { fetchImpl: fetchImpl as typeof fetch });
	});

	it("maps an unknown index to TYPE=1", async () => {
		const fetchImpl = (url: string | URL | Request) => {
			expect(String(url)).toContain('filter=(TYPE="1")');
			return Promise.resolve(Response.json({ result: { data: [] } }));
		};
		await getIndexWeights("nope", { fetchImpl: fetchImpl as typeof fetch });
	});
});

describe("getIndexWeights edge cases", () => {
	it("degrades to [] on upstream failure", async () => {
		const fetchImpl = () =>
			Promise.resolve(new Response("not found", { status: 500 }));
		expect(
			await getIndexWeights("hs300", { fetchImpl: fetchImpl as typeof fetch })
		).toEqual([]);
	});

	it("degrades to [] on network error", async () => {
		const fetchImpl = () => Promise.reject(new Error("network down"));
		expect(
			await getIndexWeights("hs300", { fetchImpl: fetchImpl as typeof fetch })
		).toEqual([]);
	});
});
