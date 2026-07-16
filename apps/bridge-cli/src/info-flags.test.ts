import { describe, expect, it } from "vitest";
import { handleInfoFlags, parseArgs, USAGE } from "./args";

const FAKE_VERSION = "1.2.3";

describe("handleInfoFlags", () => {
	it("returns the version for -v without requiring --token/--server", () => {
		expect(handleInfoFlags(["-v"], FAKE_VERSION)).toBe(FAKE_VERSION);
	});

	it("returns the version for --version", () => {
		expect(handleInfoFlags(["--version"], FAKE_VERSION)).toBe(FAKE_VERSION);
	});

	it("returns usage for -h", () => {
		expect(handleInfoFlags(["-h"], FAKE_VERSION)).toBe(USAGE);
	});

	it("returns usage for --help", () => {
		expect(handleInfoFlags(["--help"], FAKE_VERSION)).toBe(USAGE);
	});

	it("detects the flag anywhere in argv", () => {
		expect(
			handleInfoFlags(["--agent", "claude-code", "--version"], FAKE_VERSION)
		).toBe(FAKE_VERSION);
		expect(
			handleInfoFlags(["--agent", "claude-code", "--help"], FAKE_VERSION)
		).toBe(USAGE);
	});

	it("returns undefined for a normal argv so parseArgs still runs", () => {
		expect(
			handleInfoFlags(
				["--agent", "claude-code", "--token", "t", "--server", "s"],
				FAKE_VERSION
			)
		).toBeUndefined();
	});
});

// Split from "handleInfoFlags" purely for the max-lines gate.
describe("handleInfoFlags - usage text", () => {
	it("usage text documents every real flag", () => {
		const flags = [
			"--agent",
			"--client",
			"--pair",
			"--name",
			"--server",
			"--token",
			"--dir",
			"--label",
			"--resume",
			"--opencode-transport",
			"--debug",
			"-v",
			"--version",
			"-h",
			"--help",
		];
		for (const flag of flags) {
			expect(USAGE).toContain(flag);
		}
	});
});

describe("parseArgs - unaffected by info flags", () => {
	it("still parses a normal argv", () => {
		const args = parseArgs(
			["--agent", "opencode", "--token", "t", "--server", "s"],
			{}
		);
		expect(args).toMatchObject({
			agentKind: "opencode",
			serverUrl: "s",
			token: "t",
		});
	});
});
