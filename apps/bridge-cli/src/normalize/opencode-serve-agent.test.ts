import { describe, expect, it } from "vitest";
import {
	parseOpencodeServeAgents,
	parseOpencodeServeHealth,
} from "./opencode-serve-agent";

describe("parseOpencodeServeHealth", () => {
	it("extracts healthy and version from a well-formed response", () => {
		expect(
			parseOpencodeServeHealth({ healthy: true, version: "0.80.6" })
		).toEqual({ healthy: true, version: "0.80.6" });
	});

	it("leaves fields undefined when missing or the wrong type, without throwing", () => {
		expect(parseOpencodeServeHealth({})).toEqual({
			healthy: undefined,
			version: undefined,
		});
		expect(parseOpencodeServeHealth({ healthy: "yes", version: 6 })).toEqual({
			healthy: undefined,
			version: undefined,
		});
	});

	it("is undefined for non-record input", () => {
		expect(parseOpencodeServeHealth(null)).toBeUndefined();
		expect(parseOpencodeServeHealth("nope")).toBeUndefined();
	});
});

describe("parseOpencodeServeAgents", () => {
	it("keeps primary and all-mode agents, drops subagent and hidden entries", () => {
		const result = parseOpencodeServeAgents([
			{ name: "build", mode: "primary" },
			{ name: "plan", mode: "primary" },
			{ name: "everything", mode: "all" },
			{ name: "reviewer", mode: "subagent" },
			{ name: "secret", mode: "primary", hidden: true },
		]);
		expect(result).toEqual(["build", "plan", "everything"]);
	});

	it("keeps an entry with no mode field at all (treated as selectable)", () => {
		expect(parseOpencodeServeAgents([{ name: "default-agent" }])).toEqual([
			"default-agent",
		]);
	});

	it("returns [] for non-array input or entries missing a name", () => {
		expect(parseOpencodeServeAgents(null)).toEqual([]);
		expect(parseOpencodeServeAgents({})).toEqual([]);
		expect(parseOpencodeServeAgents([{ mode: "primary" }])).toEqual([]);
	});
});
