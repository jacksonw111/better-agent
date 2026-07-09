import { describe, expect, it } from "vitest";
import { getCnHot, parseTencentQuotes } from "./cn-hot";

const RANK_PAYLOAD = {
	data: [
		{ sc: "SH600519", rk: 1, hisRc: 2 },
		{ sc: "SZ000001", rk: 2, hisRc: -1 },
	],
};

// NOTE: fetchImpl stubs the Tencent quote leg with UTF-8 bytes, but getCnHot
// decodes with TextDecoder("gbk") (same caveat as quote.test.ts) — so the
// fetch-path test below only asserts ASCII-safe fields (code/rank/last/
// changePct), not the Chinese name. parseTencentQuotes is tested directly
// (pure string in) to cover the name field.
//
// Built field-by-field (rather than a hand-typed tilde string) so the
// last/changePct positions (indices 3 / 32, matching quote.ts's layout) are
// guaranteed correct.
const QUOTE_FIELD_COUNT = 35;
const FIELD_LAST = 3;
const FIELD_CHANGE_PCT = 32;

function quoteLine(
	code: string,
	name: string,
	last: number,
	changePct: number
): string {
	const fields = new Array<string>(QUOTE_FIELD_COUNT).fill("");
	fields[0] = "1";
	fields[1] = name;
	fields[2] = code.slice(2);
	fields[FIELD_LAST] = String(last);
	fields[FIELD_CHANGE_PCT] = String(changePct);
	return `v_${code}="${fields.join("~")}";`;
}

const QUOTE_PAYLOAD =
	quoteLine("sh600519", "贵州茅台", 1680, 1.2) +
	quoteLine("sz000001", "平安银行", 11.2, 1.82);

function fetchImplFor(): typeof fetch {
	return ((url: string | URL | Request, init?: RequestInit) => {
		const href = String(url);
		if (href.includes("emappdata.eastmoney.com/stockrank/getAllCurrentList")) {
			expect(init?.method).toBe("POST");
			expect(init?.headers).toMatchObject({
				"Content-Type": "application/json",
			});
			const body = JSON.parse(String(init?.body));
			expect(body).toMatchObject({
				appId: "appId01",
				globalId: "786e4c21-70dc-435a-93bb-38",
				marketType: "",
				pageNo: 1,
			});
			return Promise.resolve(Response.json(RANK_PAYLOAD));
		}
		if (href.includes("qt.gtimg.cn/q=")) {
			expect(href).toContain("sh600519");
			expect(href).toContain("sz000001");
			return Promise.resolve(
				new Response(new TextEncoder().encode(QUOTE_PAYLOAD))
			);
		}
		throw new Error(`unexpected URL in test: ${href}`);
	}) as typeof fetch;
}

describe("parseTencentQuotes: pure parse", () => {
	it('parses multiple v_<code>="..." lines into a code->quote map', () => {
		const map = parseTencentQuotes(QUOTE_PAYLOAD);
		expect(map.get("sh600519")).toEqual({
			name: "贵州茅台",
			last: 1680,
			changePct: 1.2,
		});
		expect(map.get("sz000001")).toEqual({
			name: "平安银行",
			last: 11.2,
			changePct: 1.82,
		});
	});
});

describe("getCnHot: rank + enrichment", () => {
	it("returns rank-ordered rows with enriched code/last/changePct", async () => {
		const rows = await getCnHot(20, { fetchImpl: fetchImplFor() });
		expect(rows).toHaveLength(2);
		expect(rows[0]).toMatchObject({
			rank: 1,
			code: "600519",
			last: 1680,
			changePct: 1.2,
			rankChange: 2,
		});
		expect(rows[1]).toMatchObject({
			rank: 2,
			code: "000001",
			rankChange: -1,
		});
	});

	it("sends the requested pageSize as the POST body limit", async () => {
		const fetchImpl = ((url: string | URL | Request, init?: RequestInit) => {
			if (String(url).includes("getAllCurrentList")) {
				const body = JSON.parse(String(init?.body));
				expect(body.pageSize).toBe(5);
				return Promise.resolve(Response.json({ data: [] }));
			}
			return Promise.resolve(Response.json({}));
		}) as typeof fetch;
		await getCnHot(5, { fetchImpl });
	});
});

describe("getCnHot: degradation", () => {
	it("degrades to [] when the rank POST fails", async () => {
		const fetchImpl = () =>
			Promise.resolve(new Response("boom", { status: 500 }));
		expect(
			await getCnHot(20, { fetchImpl: fetchImpl as typeof fetch })
		).toEqual([]);
	});

	it("still returns rows (blank enrichment) when the quote leg fails", async () => {
		const fetchImpl = ((url: string | URL | Request) => {
			const href = String(url);
			if (href.includes("getAllCurrentList")) {
				return Promise.resolve(Response.json(RANK_PAYLOAD));
			}
			return Promise.resolve(new Response("boom", { status: 500 }));
		}) as typeof fetch;
		const rows = await getCnHot(20, { fetchImpl });
		expect(rows).toHaveLength(2);
		expect(rows[0]).toMatchObject({
			rank: 1,
			code: "600519",
			name: "",
			last: 0,
			changePct: 0,
		});
	});
});
