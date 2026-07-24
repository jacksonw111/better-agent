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

/** Narrows the discriminated union so existing session assertions can keep
 * reading session-only fields — the only behavior they exercise is unchanged. */
function parseSession(argv: string[] = BASE) {
	const args = parseArgs(argv, {});
	if (args.mode !== "session") {
		throw new Error("Expected session arguments");
	}
	return args;
}

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
			mode: "session",
			agentKind: "claude-code",
			token: "bt_abc",
			serverUrl: "https://bridge.example.com",
			dir: "/tmp",
			label: "my repo",
			opencodeTransport: "acp",
			resume: "claude-session-abc",
			debug: false,
			cua: false,
			cuaVncUrl: undefined,
			cuaVm: undefined,
			cuaImage: undefined,
		});
	});

	it("defaults resume to undefined when --resume is omitted", () => {
		const args = parseSession();
		expect(args.resume).toBeUndefined();
	});

	it("sets debug when --debug is passed", () => {
		const args = parseSession([...BASE, "--debug"]);
		expect(args.debug).toBe(true);
	});

	it("defaults dir to the current working directory and label to undefined", () => {
		const args = parseSession();
		expect(args.dir).toBe(process.cwd());
		expect(args.label).toBeUndefined();
	});
});

// Split from "parseArgs - accepted input" purely for the max-lines gate.
describe("parseArgs - accepted agent kinds", () => {
	it("accepts pi as an agent kind", () => {
		const args = parseSession([
			"--agent",
			"pi",
			"--token",
			"t",
			"--server",
			"s",
		]);
		expect(args.agentKind).toBe("pi");
	});
});

describe("parseArgs - cua", () => {
	it("sets cua and cuaVncUrl from their flags", () => {
		expect(parseSession([...BASE, "--cua"]).cua).toBe(true);
		const withUrl = parseSession([...BASE, "--cua-vnc-url", "localhost:5900"]);
		expect(withUrl.cuaVncUrl).toBe("localhost:5900");
	});
});

describe("parseArgs - opencode transport", () => {
	it("defaults --opencode-transport to acp", () => {
		expect(parseSession().opencodeTransport).toBe("acp");
	});

	it("accepts --opencode-transport serve", () => {
		const args = parseSession([...BASE, "--opencode-transport", "serve"]);
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
		expect(args).toMatchObject({
			serverUrl: "https://env.example.com",
			token: "bt_env",
		});
	});

	it("prefers an explicit flag over the env var", () => {
		const args = parseArgs(BASE, { BETTER_AGENT_BRIDGE_TOKEN: "bt_env" });
		expect(args).toMatchObject({ token: "bt_abc" });
	});
});

describe("parseArgs - client mode", () => {
	const CLIENT_BASE = ["--client", "--server", "https://bridge.example.com"];

	it("parses --client with --pair and --name, requiring no token or agent", () => {
		const args = parseArgs(
			[...CLIENT_BASE, "--pair", "pc_code123", "--name", "Studio Mac"],
			{}
		);
		expect(args).toEqual({
			mode: "client",
			name: "Studio Mac",
			pairCode: "pc_code123",
			serverUrl: "https://bridge.example.com",
		});
	});

	it("leaves pairCode undefined when --pair is omitted", () => {
		const args = parseArgs(CLIENT_BASE, {});
		expect(args.mode).toBe("client");
		if (args.mode === "client") {
			expect(args.pairCode).toBeUndefined();
		}
	});

	it("uses the OS hostname when --name is omitted", () => {
		const args = parseArgs(CLIENT_BASE, {});
		expect(args.mode).toBe("client");
		if (args.mode === "client") {
			expect(args.name.length).toBeGreaterThan(0);
		}
	});

	it("falls back to the server env var", () => {
		const args = parseArgs(["--client"], {
			BETTER_AGENT_BRIDGE_SERVER: "https://env.example.com",
		});
		expect(args).toMatchObject({ serverUrl: "https://env.example.com" });
	});
});

describe("parseArgs - client mode rejections", () => {
	it("rejects combining --client with --agent", () => {
		expect(() => parseArgs([...BASE, "--client"], {})).toThrow(
			"--client cannot be combined with --agent"
		);
	});

	it("rejects --pair outside client mode", () => {
		expect(() => parseArgs([...BASE, "--pair", "pc_code123"], {})).toThrow(
			"--pair requires --client"
		);
	});

	it("rejects a missing server in client mode", () => {
		expect(() => parseArgs(["--client"], {})).toThrow(MISSING_SERVER);
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

describe("parseArgs - sync mode", () => {
	it("parses sync with token + server and optional force/project", () => {
		const args = parseArgs(
			[
				"sync",
				"--server",
				"https://s",
				"--token",
				"bt_abc",
				"--force",
				"--project",
				"proj-1",
			],
			{}
		);
		expect(args).toEqual({
			force: true,
			mode: "sync",
			projectId: "proj-1",
			serverUrl: "https://s",
			token: "bt_abc",
		});
	});

	it("defaults force to false and projectId to undefined", () => {
		const args = parseArgs(["sync", "--server", "s", "--token", "bt_abc"], {});
		expect(args).toMatchObject({
			force: false,
			mode: "sync",
			projectId: undefined,
		});
	});

	it("falls back to env vars for token and server", () => {
		const args = parseArgs(["sync"], {
			BETTER_AGENT_BRIDGE_SERVER: "https://env",
			BETTER_AGENT_BRIDGE_TOKEN: "bt_env",
		});
		expect(args).toMatchObject({ serverUrl: "https://env", token: "bt_env" });
	});

	it("rejects sync without a token", () => {
		expect(() => parseArgs(["sync", "--server", "s"], {})).toThrow(
			"--token is required"
		);
	});
});
