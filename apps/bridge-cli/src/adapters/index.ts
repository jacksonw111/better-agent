import { claudeCodeAdapter } from "./claude-code";
import { codexAdapter } from "./codex";
import { opencodeAdapter } from "./opencode";
import { opencodeServeAdapter } from "./opencode-serve";
import { piAdapter } from "./pi";
import type { Adapter, AgentKind, OpencodeTransport } from "./types";

export type {
	Adapter,
	AgentHandle,
	AgentKind,
	OpencodeTransport,
	StartOptions,
} from "./types";

/** Each agent's underlying CLI binary (spawned from PATH — none are bundled
 * into the standalone bridge) and a one-line install hint, surfaced by the
 * startup pre-flight when the binary is missing so a new user knows exactly
 * what to install. */
export const AGENT_CLI: Record<AgentKind, { binary: string; install: string }> =
	{
		"claude-code": {
			binary: "claude",
			install: "npm i -g @anthropic-ai/claude-code",
		},
		opencode: {
			binary: "opencode",
			install: "curl -fsSL https://opencode.ai/install | bash",
		},
		codex: {
			binary: "codex",
			install: "npm i -g @openai/codex",
		},
		pi: {
			binary: "pi",
			install: "see https://github.com/badlogic/pi-mono",
		},
	};

/** Knobs beyond the agent kind that pick a specific transport. Only opencode
 * has more than one (see `OpencodeTransport`). */
export interface SelectAdapterOptions {
	opencodeTransport?: OpencodeTransport;
}

/** Picks the adapter for the agent kind selected on the CLI (`--agent`),
 * honoring `--opencode-transport` for opencode (default: acp — serve is
 * opt-in until its wire shapes are verified against a real binary). */
export function selectAdapter(
	agentKind: AgentKind,
	options?: SelectAdapterOptions
): Adapter {
	switch (agentKind) {
		case "claude-code":
			return claudeCodeAdapter;
		case "opencode":
			return options?.opencodeTransport === "serve"
				? opencodeServeAdapter
				: opencodeAdapter;
		case "codex":
			return codexAdapter;
		case "pi":
			return piAdapter;
		default:
			throw new Error(`Unknown agent kind: ${agentKind satisfies never}`);
	}
}
