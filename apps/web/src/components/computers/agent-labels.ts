/** Display names for the supported Agent Runtime kinds (spec §6.1). Shared by
 * the Computers list and the Tasks surfaces so runtime naming can't drift. */
export const AGENT_LABELS = {
	"claude-code": "Claude Code",
	opencode: "OpenCode",
	codex: "Codex",
	pi: "Pi",
} as const;
