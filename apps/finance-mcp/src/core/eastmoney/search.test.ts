import { describe, expect, it } from "vitest";
import { searchAStocks } from "./search";

function jsonpResponse(rows: unknown[]): Response {
	return new Response(
		`jsonp(${JSON.stringify({ QuotationCodeTable: { Data: rows } })})`
	);
}

describe("searchAStocks", () => {
	it("keeps only A-share/NEEQ 6-digit hits and derives exchange", async () => {
		const rows = [
			{ Classify: "AStock", Code: "600519", Name: "贵州茅台" },
			{ Classify: "AStock", Code: "000001", Name: "平安银行" },
			{ Classify: "HKStock", Code: "00700", Name: "腾讯控股" },
		];
		const fetchImpl = () => Promise.resolve(jsonpResponse(rows));
		const hits = await searchAStocks("茅台", {
			fetchImpl: fetchImpl as typeof fetch,
		});
		expect(hits).toHaveLength(2);
		expect(hits[0]).toEqual({
			code: "600519",
			market: "a_share",
			exchange: "SH",
			name: "贵州茅台",
		});
		expect(hits[1]?.exchange).toBe("SZ");
	});

	it("degrades to [] on a malformed/non-JSONP upstream body", async () => {
		const fetchImpl = () => Promise.resolve(new Response("<html>oops</html>"));
		const hits = await searchAStocks("x", {
			fetchImpl: fetchImpl as typeof fetch,
		});
		expect(hits).toEqual([]);
	});
});
