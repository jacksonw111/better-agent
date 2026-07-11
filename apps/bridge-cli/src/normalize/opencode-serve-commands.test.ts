import { describe, expect, it } from "vitest";
import { parseOpencodeServeCommands } from "./opencode-serve-commands";

describe("parseOpencodeServeCommands", () => {
	it("extracts name/description pairs from a well-formed response", () => {
		const result = parseOpencodeServeCommands([
			{ name: "help", description: "Show help" },
			{ name: "clear" },
		]);
		expect(result).toEqual([
			{ name: "help", description: "Show help" },
			{ name: "clear", description: undefined },
		]);
	});

	it("drops entries missing a name", () => {
		expect(
			parseOpencodeServeCommands([{ description: "no name" }, { name: "ok" }])
		).toEqual([{ name: "ok", description: undefined }]);
	});

	it("returns [] for non-array input", () => {
		expect(parseOpencodeServeCommands(null)).toEqual([]);
		expect(parseOpencodeServeCommands({})).toEqual([]);
	});
});
