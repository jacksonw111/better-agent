import { describe, expect, it } from "vitest";
import { BadSymbolError, parseSymbol } from "./symbol";

describe("parseSymbol", () => {
	it.each([
		["600000.SH", "a", "600000", "sh600000"],
		["000001.SZ", "a", "000001", "sz000001"],
		["600000", "a", "600000", "sh600000"],
		["000001", "a", "000001", "sz000001"],
		["688981", "a", "688981", "sh688981"],
		["00700.HK", "hk", "00700", "hk00700"],
		["700.HK", "hk", "00700", "hk00700"],
		["AAPL", "us", "AAPL", "usAAPL"],
		["aapl.us", "us", "AAPL", "usAAPL"],
	])("maps %s", (input, market, code, tencent) => {
		expect(parseSymbol(input)).toEqual({ market, code, tencent });
	});

	it("throws on empty", () => {
		expect(() => parseSymbol("")).toThrow(BadSymbolError);
	});
});
