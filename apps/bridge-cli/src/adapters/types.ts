// The legacy structured adapter contract (Adapter/AgentHandle/StartOptions,
// SessionCapabilities, event normalization) was removed with the PTY rewrite
// (P2-3). What remains here is the small, transport-agnostic vocabulary that
// still-live modules (args parsing, tool inventory, skill/MCP materialization)
// depend on: the set of agent kinds and the opencode transport knob.

/** Which local coding agent a bridge session drives. Mirrors `AGENT_KINDS`
 * in `packages/api/src/routers/bridge.ts` — keep the two in sync. */
export type AgentKind = "claude-code" | "opencode" | "codex" | "pi";

/** Which wire protocol drives the opencode agent: `acp` (the default —
 * stdio JSON-RPC) or `serve` (HTTP + SSE). Ignored by every other agent
 * kind. Retained purely so `--opencode-transport` keeps validating. */
export type OpencodeTransport = "acp" | "serve";

export const OPENCODE_TRANSPORTS: readonly OpencodeTransport[] = [
	"acp",
	"serve",
];

// The server-resolved startup shapes (ResolvedSkill / ResolvedMcpServer /
// AgentStartConfig) still back Profile skill/MCP materialization — re-exported
// from ./start-config so existing `./types` imports keep working.
export type {
	AgentStartConfig,
	ResolvedMcpServer,
	ResolvedSkill,
} from "./start-config";
