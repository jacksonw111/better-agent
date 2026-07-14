import { describe, expect, it } from "vitest";
import { md5Hex } from "./md5";

// RFC 1321 appendix A.5 vectors plus a multi-byte UTF-8 case and a 56-byte
// message (forces the two-block padding path).
describe("md5Hex: RFC 1321 vectors", () => {
	it("hashes the empty string", () => {
		expect(md5Hex("")).toBe("d41d8cd98f00b204e9800998ecf8427e");
	});

	it('hashes "abc"', () => {
		expect(md5Hex("abc")).toBe("900150983cd24fb0d6963f7d28e17f72");
	});

	it('hashes "message digest"', () => {
		expect(md5Hex("message digest")).toBe("f96b697d7cb7938d525a2f31aaf161d0");
	});

	it("hashes the RFC alphanumeric vector", () => {
		expect(
			md5Hex("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789")
		).toBe("d174ab98d277d9f5a5611c2c9f419d9f");
	});
});

describe("md5Hex: padding and UTF-8 edge cases", () => {
	it("hashes a 56-byte message (length field spills to a second block)", () => {
		expect(md5Hex("a".repeat(56))).toBe("3b0c8ac703f828b04c6c197006d17218");
	});

	it("hashes multi-byte UTF-8 input", () => {
		expect(md5Hex("你好")).toBe("7eca689f0d3389d9dea66ae112e5cfd7");
	});
});
