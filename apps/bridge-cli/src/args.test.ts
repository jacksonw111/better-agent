import { describe, expect, it } from "vitest";
import { parseArgs } from "./args";

const MISSING_AGENT = /--agent is required/;
const UNKNOWN_AGENT = /Unknown --agent/;
const MISSING_TOKEN = /--token is required/;
const MISSING_SERVER = /--server is required/;
const MISSING_VALUE = /Missing value for --agent/;
const UNKNOWN_OPENCODE_TRANSPORT = /Unknown --opencode-transport/;

const BASE = [
	"--agent",
	"claude-code",
	"--token",
	"bt_abc",
	"--server",
	"https://bridge.example.com",
];

describe("parseArgs - accepted input", () => {
	it("parses all flags", () => {
		const args = parseArgs(
			[
				...BASE,
				"--dir",
				"/tmp",
				"--label",
				"my repo",
				"--resume",
				"claude-session-abc",
			],
			{}
		);
		expect(args).toEqual({
			agentKind: "claude-code",
			token: "bt_abc",
			serverUrl: "https://bridge.example.com",
			dir: "/tmp",
			label: "my repo",
			opencodeTransport: "acp",
			resume: "claude-session-abc",
			debug: false,
			cua: false,
		});
	});

	it("defaults resume to undefined when --resume is omitted", () => {
		const args = parseArgs(BASE, {});
		expect(args.resume).toBeUndefined();
	});

	it("sets debug when --debug is passed", () => {
		const args = parseArgs([...BASE, "--debug"], {});
		expect(args.debug).toBe(true);
	});

	it("defaults dir to the current working directory and label to undefined", () => {
		const args = parseArgs(BASE, {});
		expect(args.dir).toBe(process.cwd());
		expect(args.label).toBeUndefined();
	});

	it("accepts pi as an agent kind", () => {
		const args = parseArgs(
			["--agent", "pi", "--token", "t", "--server", "s"],
			{}
		);
		expect(args.agentKind).toBe("pi");
	});
});

describe("parseArgs - opencode transport", () => {
	it("defaults --opencode-transport to acp", () => {
		expect(parseArgs(BASE, {}).opencodeTransport).toBe("acp");
	});

	it("accepts --opencode-transport serve", () => {
		const args = parseArgs([...BASE, "--opencode-transport", "serve"], {});
		expect(args.opencodeTransport).toBe("serve");
	});

	it("rejects an unknown --opencode-transport value", () => {
		expect(() =>
			parseArgs([...BASE, "--opencode-transport", "http"], {})
		).toThrow(UNKNOWN_OPENCODE_TRANSPORT);
	});
});

// Split from "parseArgs - accepted input" purely to keep each describe's
// callback under the repo's max-lines-per-function gate.
describe("parseArgs - env var fallback", () => {
	it("falls back to env vars for token and server", () => {
		const args = parseArgs(["--agent", "opencode"], {
			BETTER_AGENT_BRIDGE_TOKEN: "bt_env",
			BETTER_AGENT_BRIDGE_SERVER: "https://env.example.com",
		});
		expect(args.token).toBe("bt_env");
		expect(args.serverUrl).toBe("https://env.example.com");
	});

	it("prefers an explicit flag over the env var", () => {
		const args = parseArgs(BASE, { BETTER_AGENT_BRIDGE_TOKEN: "bt_env" });
		expect(args.token).toBe("bt_abc");
	});
});

describe("parseArgs - rejected input", () => {
	it("rejects a missing --agent", () => {
		expect(() => parseArgs(["--token", "bt_abc", "--server", "s"], {})).toThrow(
			MISSING_AGENT
		);
	});

	it("rejects an unknown agent kind", () => {
		expect(() =>
			parseArgs(["--agent", "gpt5", "--token", "t", "--server", "s"], {})
		).toThrow(UNKNOWN_AGENT);
	});

	it("rejects a missing token with no env fallback", () => {
		expect(() => parseArgs(["--agent", "codex", "--server", "s"], {})).toThrow(
			MISSING_TOKEN
		);
	});

	it("rejects a missing server with no env fallback", () => {
		expect(() => parseArgs(["--agent", "codex", "--token", "t"], {})).toThrow(
			MISSING_SERVER
		);
	});

	it("rejects a flag with a missing value", () => {
		expect(() => parseArgs(["--agent"], {})).toThrow(MISSING_VALUE);
	});

	// A nonexistent cwd spawns with the same ENOENT as a missing binary, which
	// misled a real user into hunting a "claude not installed" problem when
	// --dir was misspelled. Fail fast at parse time with the real reason.
	it("rejects a --dir that does not exist", () => {
		expect(() =>
			parseArgs(
				[
					"--agent",
					"codex",
					"--token",
					"t",
					"--server",
					"s",
					"--dir",
					"/nonexistent-path-for-test",
				],
				{}
			)
		).toThrow("--dir does not exist: /nonexistent-path-for-test");
	});
});
