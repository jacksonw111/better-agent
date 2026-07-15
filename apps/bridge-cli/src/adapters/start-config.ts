// The server-resolved startup-config shapes `StartOptions` (./types.ts)
// carries — split out of types.ts purely to keep that file under the repo's
// 300-line cap (same precedent as ./quota/types.ts), re-exported from
// "./types" so existing imports keep working.

/** An MCP server resolved server-side (`resolveMcpServers` in
 * `packages/api`), redeclared locally so the CLI takes no runtime dep on the
 * API package — same reason `AgentStartConfig` is redeclared. `headers`
 * already carries the decrypted `Authorization` (never the ciphertext); the
 * transport is HTTP (`type: "http"` in the SDK/agent config the adapters
 * build). */
export interface ResolvedMcpServer {
	headers: Record<string, string>;
	name: string;
	url: string;
}

/** A skill resolved server-side (`resolveSkills` in `packages/api`) into the
 * three parts a `SKILL.md` needs — its frontmatter `name`/`description` and
 * the markdown body (`instructions`). Redeclared locally so the CLI takes no
 * runtime dep on the API package (same reason as `ResolvedMcpServer`). */
export interface ResolvedSkill {
	description: string;
	instructions: string;
	name: string;
}

/** Startup config the bridge CLI forwards to an adapter (a subset of the
 * server's `BridgeTokenConfig`, redeclared locally so the CLI doesn't take a
 * runtime dep on `@better-agent/agent`). */
export interface AgentStartConfig {
	appendSystemPrompt?: string;
	effort?: "low" | "medium" | "high" | "xhigh" | "max";
	maxBudgetUsd?: number;
	maxTurns?: number;
	/** The model id to start the session with. Only claude-code applies this
	 * (SDK `Options.model`) as of R2-b; see per-adapter notes for the rest. */
	model?: string;
	/** The permission mode to start the session with (agent-specific values,
	 * e.g. claude's "default"/"plan"/"acceptEdits"/…). Only claude-code applies
	 * this as of R2-b — ignored (not just unsupported) by pi, which has no
	 * permission-mode concept at all. */
	permissionMode?: string;
}
