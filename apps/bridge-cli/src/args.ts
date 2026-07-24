import { existsSync, statSync } from "node:fs";
import { hostname } from "node:os";
import { resolve } from "node:path";
import {
	type AgentKind,
	OPENCODE_TRANSPORTS,
	type OpencodeTransport,
} from "./adapters/types";
import { parseSyncArgs, type SyncCliArgs } from "./args-sync";

export type { SyncCliArgs } from "./args-sync";

const AGENT_KINDS: AgentKind[] = ["claude-code", "opencode", "codex", "pi"];

export const USAGE = `Usage:
  agent-cli --client --server <url> [--pair <code>] [--name <computer>]
  agent-cli --agent <kind> --server <url> --token <token> [options]
  agent-cli sync --server <url> --token <bt_token> [--force] [--project <id>]
(alias: better-agent-bridge — kept for existing scripts)

Modes:
  --client          Keep this Computer registered and connected (starts no Agent)
  --agent <kind>    Run one bridge session: claude-code | opencode | codex | pi
  sync              Materialize your Profile (standards, skills, MCP) into
                    ~/.claude — runs automatically before a project session too

Required for both modes:
  --server <url>    Better Agent server URL (or BETTER_AGENT_BRIDGE_SERVER)

Client options:
  --pair <code>     One-time pairing code from the web Computers page (first run
                    only — afterwards the saved identity file is used)
  --name <text>     Computer name shown in Better Agent (default: OS hostname)

Session options:
  --token <token>                  Bridge auth token (or BETTER_AGENT_BRIDGE_TOKEN)
  --dir <path>                     Working directory for the agent (default: cwd)
  --label <text>                   Session label shown in the web Local Agent view
  --resume <id>                    Resume a prior claude-code session id
  --opencode-transport <acp|serve> Protocol driving opencode (default: acp)
  --cua                            Provision a local VM (auto-installs lume on
                                   macOS/Apple Silicon) and stream its desktop
                                   over VNC for remote control
  --cua-vm <name>                  Use this existing lume VM (skips the image
                                   pull if it already exists)
  --cua-image <image:tag>          Image to pull only when the VM is absent
                                   (default: macos-sequoia-cua:latest)
  --cua-vnc-url <host:port>        Skip lume/VM provisioning and relay this VNC
                                   directly (testing — e.g. localhost:5900 for
                                   macOS Screen Sharing). Implies --cua.
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

/** The pre-existing session mode's full flag set. `SessionCliArgs` layers the
 * `mode` discriminator on top so downstream session code (restart loop,
 * relay) keeps consuming this shape unchanged. */
export interface BridgeCliArgs {
	agentKind: AgentKind;
	/** `--cua`: auto-provision a local lume VM and stream it over VNC (remote
	 * control). macOS/Apple Silicon only; errors clearly elsewhere. */
	cua: boolean;
	/** `--cua-image <image:tag>`: image to pull ONLY when the VM is absent. */
	cuaImage: string | undefined;
	/** `--cua-vm <name>`: use this existing lume VM instead of the default —
	 * if it already exists, nothing is pulled. */
	cuaVm: string | undefined;
	/** `--cua-vnc-url <host:port>`: relay this VNC directly instead of
	 * provisioning a lume VM — a lume-free test path (implies CUA). */
	cuaVncUrl: string | undefined;
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

export interface SessionCliArgs extends BridgeCliArgs {
	mode: "session";
}

/** `--client`: a Computer-plane daemon (register + heartbeat, D1 signed auth
 * from the identity file) — no bridge token and no Agent process, ever. */
export interface ClientCliArgs {
	mode: "client";
	/** Computer name shown in the web Computers page (default: OS hostname). */
	name: string;
	/** One-time pairing code (`--pair pc_…`), present only on the first run —
	 * afterwards the saved identity file carries the credentials. */
	pairCode: string | undefined;
	serverUrl: string;
}

export type CliArgs = SessionCliArgs | ClientCliArgs | SyncCliArgs;

const FLAG_TO_FIELD = {
	"--agent": "agentKind",
	"--cua-image": "cuaImage",
	"--cua-vm": "cuaVm",
	"--cua-vnc-url": "cuaVncUrl",
	"--dir": "dir",
	"--label": "label",
	"--name": "name",
	"--opencode-transport": "opencodeTransport",
	"--pair": "pairCode",
	"--project": "projectId",
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

type CollectedFlags = Partial<Record<FlagField, string>>;

/** `--client` branch: no bridge token (D1 signed identity replaces it) and no
 * working directory — the client daemon never starts an Agent. */
function parseClientArgs(
	flags: CollectedFlags,
	env: Record<string, string | undefined>
): ClientCliArgs {
	if (flags.agentKind !== undefined) {
		throw new Error("--client cannot be combined with --agent");
	}
	const serverUrl = flags.serverUrl ?? env.BETTER_AGENT_BRIDGE_SERVER;
	if (serverUrl === undefined) {
		throw new Error("--server is required (or set BETTER_AGENT_BRIDGE_SERVER)");
	}
	return {
		mode: "client",
		name: flags.name ?? hostname(),
		pairCode: flags.pairCode,
		serverUrl,
	};
}

/**
 * Parses `agent-cli`'s CLI arguments into the discriminated `CliArgs` union:
 * `--client` selects the Computer client mode (`--pair`, `--name`); otherwise
 * the pre-existing session mode parses exactly as before (`--agent`, `--dir`,
 * `--token`, `--server`, and the optional
 * `--label`/`--resume`/`--opencode-transport`). Falls back to
 * env vars (`BETTER_AGENT_BRIDGE_TOKEN`, `BETTER_AGENT_BRIDGE_SERVER`) and the
 * current working directory so the token/server don't have to be typed on
 * every run.
 */
export function parseArgs(
	argv: string[],
	env: Record<string, string | undefined> = process.env
): CliArgs {
	const flags = collectFlags(argv);

	if (argv[0] === "sync") {
		return parseSyncArgs(argv, flags, env);
	}
	if (argv.includes("--client")) {
		return parseClientArgs(flags, env);
	}
	if (flags.pairCode !== undefined) {
		throw new Error("--pair requires --client");
	}
	return parseSessionArgs(argv, flags, env);
}

/** The pre-existing session parse, byte-for-byte — only hoisted out of
 * `parseArgs` so the mode split doesn't push it over the complexity gate. */
function parseSessionArgs(
	argv: string[],
	flags: CollectedFlags,
	env: Record<string, string | undefined>
): SessionCliArgs {
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
		mode: "session",
		agentKind,
		token,
		serverUrl,
		dir: validateDir(flags.dir ?? process.cwd()),
		label: flags.label,
		opencodeTransport: validateOpencodeTransport(flags.opencodeTransport),
		resume: flags.resume,
		debug: argv.includes("--debug"),
		cua: argv.includes("--cua"),
		cuaVncUrl: flags.cuaVncUrl,
		cuaVm: flags.cuaVm,
		cuaImage: flags.cuaImage,
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
