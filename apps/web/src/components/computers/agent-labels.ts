/** Display names for the supported Agent Runtime kinds (spec §6.1). Shared by
 * the Computers list and the Tasks surfaces so runtime naming can't drift. */
export const AGENT_LABELS = {
	"claude-code": "Claude Code",
	opencode: "OpenCode",
	codex: "Codex",
	pi: "Pi",
} as const;

export type AgentKind = keyof typeof AGENT_LABELS;

/** Narrow a path param to a real agent kind, or null for a bad link. */
export function parseAgentKind(value: string): AgentKind | null {
	return value in AGENT_LABELS ? (value as AgentKind) : null;
}
