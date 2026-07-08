import { describe, expect, it } from "vitest";
import { getStockResearch } from "./research";

function jsonpResponse(rows: unknown[]): Response {
	return new Response(`jsonp(${JSON.stringify({ data: rows })})`);
}

describe("getStockResearch normalization", () => {
	it("normalizes JSONP rows and builds a proxied pdfUrl", async () => {
		const rows = [
			{
				infoCode: "AP202607080001",
				orgSName: "中信证券",
				title: "贵州茅台:稳健增长",
				publishDate: "2026-07-01 00:00:00",
				predictThisYearEps: "68.5",
				predictNextYearEps: "75.2",
				predictNextTwoYearEps: "",
				predictThisYearPe: "24.1",
				predictNextYearPe: "21.9",
				predictNextTwoYearPe: "n/a",
			},
		];
		const fetchImpl = () => Promise.resolve(jsonpResponse(rows));
		const reports = await getStockResearch("600519.SH", {
			fetchImpl: fetchImpl as typeof fetch,
			now: Date.parse("2026-07-08"),
		});
		expect(reports).toHaveLength(1);
		expect(reports[0]).toMatchObject({
			title: "贵州茅台:稳健增长",
			org: "中信证券",
			date: "2026-07-01",
			epsY0: 68.5,
			epsY1: 75.2,
			epsY2: null,
			peY0: 24.1,
			peY1: 21.9,
			peY2: null,
		});
		expect(reports[0]?.pdfUrl).toBe(
			`/pdf?url=${encodeURIComponent("https://pdf.dfcfw.com/pdf/H3_AP202607080001_1.pdf")}`
		);
	});
});

describe("getStockResearch edge cases", () => {
	it("returns [] for non-A-share symbols without hitting the network", async () => {
		let calls = 0;
		const fetchImpl = () => {
			calls++;
			return Promise.resolve(jsonpResponse([]));
		};
		const reports = await getStockResearch("AAPL", {
			fetchImpl: fetchImpl as typeof fetch,
		});
		expect(reports).toEqual([]);
		expect(calls).toBe(0);
	});

	it("degrades to [] on a malformed/non-JSONP upstream body", async () => {
		const fetchImpl = () => Promise.resolve(new Response("not jsonp"));
		const reports = await getStockResearch("600519.SH", {
			fetchImpl: fetchImpl as typeof fetch,
		});
		expect(reports).toEqual([]);
	});
});
