import { describe, expect, it } from "vitest";
import { getHotConcepts, toBareCode } from "./hot-concept";

const PAYLOAD = {
	data: [
		{ conceptName: "白酒", conceptId: "BK0896", hitCount: 128 },
		{ conceptName: "消费", conceptId: "BK0438", hitCount: 64 },
	],
};

function fetchImplFor(expectedSecCode: string): typeof fetch {
	return ((url: string | URL | Request, init?: RequestInit) => {
		expect(String(url)).toContain(
			"emappdata.eastmoney.com/stockrank/getHotStockRankList"
		);
		expect(init?.method).toBe("POST");
		expect(JSON.parse(String(init?.body))).toEqual({
			appId: "appId01",
			globalId: "786e4c21-70dc-435a-93bb-38",
			srcSecurityCode: expectedSecCode,
		});
		return Promise.resolve(Response.json(PAYLOAD));
	}) as typeof fetch;
}

describe("toBareCode: defensive normalization", () => {
	it("strips .SH/.SZ suffixes and SH/SZ prefixes", () => {
		expect(toBareCode("600519")).toBe("600519");
		expect(toBareCode("600519.SH")).toBe("600519");
		expect(toBareCode("000001.sz")).toBe("000001");
		expect(toBareCode("SH600519")).toBe("600519");
		expect(toBareCode(" sz000001 ")).toBe("000001");
	});
});

describe("getHotConcepts: happy path", () => {
	it("prefixes SH for 6xxxxx codes and maps rows", async () => {
		const rows = await getHotConcepts("600519.SH", {
			fetchImpl: fetchImplFor("SH600519"),
		});
		expect(rows).toEqual([
			{ concept: "白酒", boardCode: "BK0896", hits: 128 },
			{ concept: "消费", boardCode: "BK0438", hits: 64 },
		]);
	});

	it("prefixes SZ for non-6 codes", async () => {
		const rows = await getHotConcepts("000001", {
			fetchImpl: fetchImplFor("SZ000001"),
		});
		expect(rows).toHaveLength(2);
	});
});

describe("getHotConcepts: degradation", () => {
	it("returns [] on non-OK status", async () => {
		const fetchImpl = (() =>
			Promise.resolve(new Response("boom", { status: 500 }))) as typeof fetch;
		expect(await getHotConcepts("600519", { fetchImpl })).toEqual([]);
	});

	it("returns [] when fetch throws", async () => {
		const fetchImpl = (() =>
			Promise.reject(new Error("network down"))) as typeof fetch;
		expect(await getHotConcepts("600519", { fetchImpl })).toEqual([]);
	});

	it("returns [] when data is null", async () => {
		const fetchImpl = (() =>
			Promise.resolve(Response.json({ data: null }))) as typeof fetch;
		expect(await getHotConcepts("600519", { fetchImpl })).toEqual([]);
	});
});
