import { describe, expect, it } from "vitest";
import { getQuote, parseQuote } from "./quote";

const SH = `v_sh600000="1~浦发银行~600000~9.00~8.89~8.85~544687~323481~221557~9.00~1384~8.99~2223~8.98~911~8.97~602~8.96~374~9.01~655~9.02~17648~9.03~10161~9.04~6039~9.05~10338~~20260708161454~0.11~1.24~9.03~8.79~9.00/544687/488055514~";`;

describe("parseQuote", () => {
	it("parses A-share snapshot with 5-level depth", () => {
		const q = parseQuote(SH, "a", "600000.SH");
		expect(q.name).toBe("浦发银行");
		expect(q.last).toBe(9.0);
		expect(q.prevClose).toBe(8.89);
		expect(q.open).toBe(8.85);
		expect(q.high).toBe(9.03);
		expect(q.low).toBe(8.79);
		expect(q.changePct).toBe(1.24);
		expect(q.bids).toHaveLength(5);
		expect(q.bids[0]).toEqual({ price: 9.0, volume: 1384 });
		expect(q.asks[0]).toEqual({ price: 9.01, volume: 655 });
		expect(q.time).toBe("20260708161454");
	});

	it("drops zero-priced depth levels (US)", () => {
		const US = `v_usAAPL="200~苹果~AAPL.OQ~310.66~312.66~315.29~42490002~0~0~311.40~40~0~0~0~0~0~0~0~0~312.04~40~0~0~0~0~0~0~0~0~~2026-07-07 16:00:01~-2.00~-0.64~315.48~310.15~USD~";`;
		const q = parseQuote(US, "us", "AAPL");
		expect(q.bids).toHaveLength(1);
		expect(q.asks).toHaveLength(1);
		expect(q.last).toBe(310.66);
	});

	it("getQuote fetches and decodes", async () => {
		// NOTE: fetchImpl stubs with UTF-8 bytes (TextEncoder), but getQuote
		// decodes with TextDecoder("gbk"). That garbles multibyte (Chinese)
		// characters while leaving ASCII numeric fields intact — so this test
		// only asserts numeric fields, not `name`.
		const fetchImpl = async () => new Response(new TextEncoder().encode(SH));
		const q = await getQuote("600000.SH", {
			fetchImpl: fetchImpl as typeof fetch,
		});
		expect(q.last).toBe(9.0);
		expect(q.prevClose).toBe(8.89);
	});
});
