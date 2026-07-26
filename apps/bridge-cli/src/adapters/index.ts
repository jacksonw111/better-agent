import type { AgentKind } from "./types";

export type {
	AgentStartConfig,
	ResolvedMcpServer,
	ResolvedSkill,
} from "./start-config";
export type { AgentKind, OpencodeTransport } from "./types";

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
