import { describe, expect, it } from "vitest";
import {
	getOptionContracts,
	getOptionQuote,
	parseGreeksFields,
	parseTquoteFields,
} from "./options";

const TQ_FIELD_COUNT = 43;

// Built field-by-field so the index layout (0-11 quote block, 37 name,
// 38-42 tail) is guaranteed to match options.ts's constants.
function tquoteFields(name: string): string[] {
	const f = new Array<string>(TQ_FIELD_COUNT).fill("0");
	f[0] = "10"; // bidVol
	f[1] = "0.0612"; // bid
	f[2] = "0.0620"; // last
	f[3] = "0.0630"; // ask
	f[4] = "12"; // askVol
	f[5] = "5000"; // openInterest
	f[6] = "3.16"; // pct
	f[7] = "2.75"; // strike
	f[11] = "0.0001"; // limitDown
	f[37] = name;
	f[41] = "888"; // volume
	f[42] = "55000"; // amount
	return f;
}

// Raw greeks wire format: [0]=name, [1..3]=empty strings (must be skipped),
// then volume,delta,gamma,theta,vega,iv,high,low,tradeCode,strike,last,theory.
function greeksRaw(name: string): string[] {
	return [
		name,
		"",
		"",
		"",
		"888",
		"0.55",
		"1.9",
		"-0.21",
		"0.31",
		"0.1735",
		"0.065",
		"0.058",
		"10009156",
		"2.75",
		"0.0620",
		"0.0611",
		"",
	];
}

function sinaBody(fields: string[]): Response {
	const text = `var hq_str_X="${fields.join(",")}";`;
	return new Response(new TextEncoder().encode(text));
}

describe("pure parsers", () => {
	it("parses T-quote fields including the Chinese name at index 37", () => {
		const q = parseTquoteFields(tquoteFields("50ETF购7月2750"));
		expect(q).toMatchObject({
			bidVol: 10,
			bid: 0.0612,
			last: 0.062,
			ask: 0.063,
			openInterest: 5000,
			strike: 2.75,
			name: "50ETF购7月2750",
			volume: 888,
			amount: 55_000,
		});
		expect(parseTquoteFields(["1", "2"])).toBeNull();
	});

	it("skips the 3 empty greeks fields so delta/iv stay aligned", () => {
		const g = parseGreeksFields(greeksRaw("50ETF购7月2750"));
		expect(g).toMatchObject({
			name: "50ETF购7月2750",
			volume: 888,
			delta: 0.55,
			gamma: 1.9,
			theta: -0.21,
			vega: 0.31,
			iv: 0.1735,
			tradeCode: "10009156",
			strike: 2.75,
			theory: 0.0611,
		});
		expect(parseGreeksFields(["x", "", ""])).toBeNull();
	});
});

describe("getOptionContracts", () => {
	it("maps cate, drops the first month, and strips CON_OP_ prefixes", async () => {
		const urls: string[] = [];
		const fetchImpl = ((url: string | URL, init?: RequestInit) => {
			const href = String(url);
			urls.push(href);
			if (href.includes("StockOptionService.getStockName")) {
				expect(href).toContain("cate=300ETF");
				expect(init?.headers).toMatchObject({
					Referer: "https://stock.finance.sina.com.cn/",
				});
				return Promise.resolve(
					Response.json({
						result: {
							data: { contractMonth: ["2026-07", "2026-07", "2026-08"] },
						},
					})
				);
			}
			return Promise.resolve(
				sinaBody(["CON_OP_10009156", "CON_OP_10009157", "junk"])
			);
		}) as typeof fetch;
		const out = await getOptionContracts("510300", "put", { fetchImpl });
		expect(Object.keys(out)).toEqual(["2607", "2608"]);
		expect(out["2607"]).toEqual(["10009156", "10009157"]);
		expect(urls[1]).toContain("hq.sinajs.cn/list=OP_DOWN_5103002607");
	});

	it("degrades to {} when the month lookup fails", async () => {
		const fetchImpl = (() =>
			Promise.resolve(new Response("x", { status: 404 }))) as typeof fetch;
		expect(await getOptionContracts("510050", "call", { fetchImpl })).toEqual(
			{}
		);
	});
});

describe("getOptionQuote", () => {
	it("merges the CON_OP_ and CON_SO_ legs into one detail object", async () => {
		const fetchImpl = ((url: string | URL) => {
			const href = String(url);
			if (href.includes("list=CON_OP_10009156")) {
				return Promise.resolve(sinaBody(tquoteFields("opt")));
			}
			if (href.includes("list=CON_SO_10009156")) {
				return Promise.resolve(sinaBody(greeksRaw("opt")));
			}
			return Promise.reject(new Error(`unexpected: ${href}`));
		}) as typeof fetch;
		const q = await getOptionQuote("10009156", { fetchImpl });
		expect(q).toMatchObject({
			last: 0.062,
			strike: 2.75,
			openInterest: 5000,
			delta: 0.55,
			iv: 0.1735,
			theory: 0.0611,
			tradeCode: "10009156",
		});
	});

	it("returns null when both legs come back empty", async () => {
		const fetchImpl = (() =>
			Promise.resolve(
				new Response(new TextEncoder().encode(""))
			)) as typeof fetch;
		expect(await getOptionQuote("10009156", { fetchImpl })).toBeNull();
	});
});
