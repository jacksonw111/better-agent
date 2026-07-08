import { describe, expect, it } from "vitest";
import { BadSymbolError } from "../symbol";
import { secucode } from "./secucode";

describe("secucode", () => {
	it("maps SH A-share symbols", () => {
		expect(secucode("600519.SH")).toEqual({
			secucode: "600519.SH",
			emCode: "SH600519",
		});
	});

	it("maps SZ A-share symbols", () => {
		expect(secucode("000001.SZ")).toEqual({
			secucode: "000001.SZ",
			emCode: "SZ000001",
		});
	});

	it("throws BadSymbolError for non-A symbols", () => {
		expect(() => secucode("00700.HK")).toThrow(BadSymbolError);
		expect(() => secucode("AAPL")).toThrow(BadSymbolError);
	});
});
