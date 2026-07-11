import { existsSync, statSync } from "node:fs";
import { resolve } from "node:path";
import {
	type AgentKind,
	OPENCODE_TRANSPORTS,
	type OpencodeTransport,
} from "./adapters/types";

const AGENT_KINDS: AgentKind[] = ["claude-code", "opencode", "codex", "pi"];

export const USAGE = `Usage: agent-cli --agent <kind> --server <url> --token <token> [options]
(alias: better-agent-bridge — kept for existing scripts)

Required:
  --agent <kind>    Agent to run: claude-code | opencode | codex | pi
  --server <url>    Better Agent server URL (or BETTER_AGENT_BRIDGE_SERVER)
  --token <token>   Bridge auth token (or BETTER_AGENT_BRIDGE_TOKEN)

Options:
  --dir <path>                     Working directory for the agent (default: cwd)
  --label <text>                   Session label shown in the web Local Agent view
  --resume <id>                    Resume a prior claude-code session id
  --opencode-transport <acp|serve> Protocol driving opencode (default: acp)
  --debug                          Print verbose command/event logging
  -v, --version                    Print the version and exit
  -h, --help                       Print this help and exit
`;

/**
 * Detects `-v`/`--version` or `-h`/`--help` anywhere in the raw argv, before
 * `parseArgs` runs — `parseArgs` throws on a missing --token/--server, which
 * would otherwise turn `agent-cli -v` into an error instead of
 * printing the version. Returns the text to print, or `undefined` if neither
 * flag is present so the caller proceeds to `parseArgs` as usual.
 */
export function handleInfoFlags(
	argv: string[],
	version: string
): string | undefined {
	if (argv.includes("-v") || argv.includes("--version")) {
		return version;
	}
	return argv.includes("-h") || argv.includes("--help") ? USAGE : undefined;
}

export interface BridgeCliArgs {
	agentKind: AgentKind;
	debug: boolean;
	dir: string;
	label: string | undefined;
	/** Which protocol drives opencode (`--opencode-transport acp|serve`).
	 * Defaults to `acp` so nothing changes for existing users; `serve` opts
	 * into the HTTP+SSE adapter (see adapters/opencode-serve.ts). Ignored for
	 * every other --agent. */
	opencodeTransport: OpencodeTransport;
	/** A prior claude session id to resume (`--resume <id>`) — threaded to
	 * `adapter.start(dir, { resume })`. Only claude-code's adapter honors it;
	 * every other adapter ignores the option entirely. */
	resume: string | undefined;
	serverUrl: string;
	token: string;
}

const FLAG_TO_FIELD = {
	"--agent": "agentKind",
	"--dir": "dir",
	"--label": "label",
	"--opencode-transport": "opencodeTransport",
	"--resume": "resume",
	"--server": "serverUrl",
	"--token": "token",
} as const;

type FlagField = (typeof FLAG_TO_FIELD)[keyof typeof FLAG_TO_FIELD];

function isKnownFlag(flag: string): flag is keyof typeof FLAG_TO_FIELD {
	return flag in FLAG_TO_FIELD;
}

function collectFlags(argv: string[]): Partial<Record<FlagField, string>> {
	const values: Partial<Record<FlagField, string>> = {};
	for (let index = 0; index < argv.length; index += 1) {
		const flag = argv[index];
		if (flag === undefined || !isKnownFlag(flag)) {
			continue;
		}
		const value = argv[index + 1];
		if (value === undefined) {
			throw new Error(`Missing value for ${flag}`);
		}
		values[FLAG_TO_FIELD[flag]] = value;
		index += 1;
	}
	return values;
}

function isAgentKind(value: string): value is AgentKind {
	return (AGENT_KINDS as string[]).includes(value);
}

function isOpencodeTransport(value: string): value is OpencodeTransport {
	return (OPENCODE_TRANSPORTS as readonly string[]).includes(value);
}

function validateOpencodeTransport(
	value: string | undefined
): OpencodeTransport {
	if (value === undefined) {
		return "acp";
	}
	if (!isOpencodeTransport(value)) {
		throw new Error(
			`Unknown --opencode-transport "${value}" (expected acp | serve)`
		);
	}
	return value;
}

/**
 * Parses `agent-cli`'s CLI arguments: `--agent`, `--dir`,
 * `--token`, `--server`, and the optional
 * `--label`/`--resume`/`--opencode-transport`. Falls back to
 * env vars (`BETTER_AGENT_BRIDGE_TOKEN`, `BETTER_AGENT_BRIDGE_SERVER`) and the
 * current working directory so the token/server don't have to be typed on
 * every run.
 */
export function parseArgs(
	argv: string[],
	env: Record<string, string | undefined> = process.env
): BridgeCliArgs {
	const flags = collectFlags(argv);

	const agentKind = flags.agentKind;
	if (agentKind === undefined) {
		throw new Error(
			"--agent is required (claude-code | opencode | codex | pi)"
		);
	}
	if (!isAgentKind(agentKind)) {
		throw new Error(
			`Unknown --agent "${agentKind}" (expected claude-code | opencode | codex | pi)`
		);
	}

	const token = flags.token ?? env.BETTER_AGENT_BRIDGE_TOKEN;
	if (token === undefined) {
		throw new Error("--token is required (or set BETTER_AGENT_BRIDGE_TOKEN)");
	}

	const serverUrl = flags.serverUrl ?? env.BETTER_AGENT_BRIDGE_SERVER;
	if (serverUrl === undefined) {
		throw new Error("--server is required (or set BETTER_AGENT_BRIDGE_SERVER)");
	}

	return {
		agentKind,
		token,
		serverUrl,
		dir: validateDir(flags.dir ?? process.cwd()),
		label: flags.label,
		opencodeTransport: validateOpencodeTransport(flags.opencodeTransport),
		resume: flags.resume,
		debug: argv.includes("--debug"),
	};
}

// Fail fast with a precise message: spawning with a nonexistent cwd surfaces as
// the same ENOENT as a missing binary, which sent a user hunting for a "claude
// not installed" problem when --dir was simply misspelled.
function validateDir(dir: string): string {
	const absolute = resolve(dir);
	if (!existsSync(absolute)) {
		throw new Error(`--dir does not exist: ${absolute}`);
	}
	if (!statSync(absolute).isDirectory()) {
		throw new Error(`--dir is not a directory: ${absolute}`);
	}
	return absolute;
}
