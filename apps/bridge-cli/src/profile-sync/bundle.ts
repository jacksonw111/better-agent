// P1-C (DP3): the shape the CLI receives from `profiles.materializeBundle`
// (packages/api/src/routers/profile-materialize.ts). Redeclared locally so the
// CLI takes no runtime dependency on the API package — the same convention
// `ResolvedMcpServer`/`ResolvedSkill` follow in adapters/start-config.ts.

export interface BundleStandard {
	body: string;
	enabled: boolean;
	sortOrder: number;
	title: string;
}

export interface BundleSkill {
	description: string;
	instructions: string;
	name: string;
}

export interface BundleMcpServer {
	headers: Record<string, string>;
	id: string;
	name: string;
	url: string;
}

export interface BundleTemplate {
	claudeMd: string | null;
	description: string | null;
	id: string;
	mcpServerIds: string[];
	name: string;
	scaffold: { dirs: string[]; files: { content: string; path: string }[] };
}

export interface ProfileBundle {
	mcpServers: BundleMcpServer[];
	skills: BundleSkill[];
	standards: BundleStandard[];
	templates: BundleTemplate[];
	version: number;
}

/** The record persisted at `~/.better-agent/profile-state.json`: the last
 * landed `version` plus the manifest of exactly what this tool wrote, so a
 * later sync can clean up a removed skill / MCP server WITHOUT touching entries
 * the user placed by hand. */
export interface ProfileState {
	claudeMd: { managed: boolean };
	mcp: string[];
	skills: string[];
	version: number;
}
