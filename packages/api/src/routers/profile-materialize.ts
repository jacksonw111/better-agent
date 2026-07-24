import type { Context } from "../context";

// P1-C (DP3): the read-only "materialize bundle" a client CLI pulls to land a
// user's Profile onto a machine — the Profile's `version` plus everything the
// CLI writes into `~/.claude`: coding `standards`, the user's `skills` (as
// SKILL.md), their `mcpServers` (as `.mcp.json` entries, auth already
// decrypted), and reusable `templates`. It NEVER writes — it only reads the
// same owner-scoped stores the P1-A router already exposes, so nothing here can
// touch the Profile's write path. Owner scoping comes from the caller's own
// id; a bundle only ever contains the caller's rows.

/** A skill flattened to the three fields a `SKILL.md` needs (mirrors
 * bridge-skills-resolve's `ResolvedSkill`). */
export interface MaterializedSkill {
	description: string;
	instructions: string;
	name: string;
}

/** An MCP server resolved to a connectable `.mcp.json` entry — `headers`
 * already carries the decrypted `Authorization` (a secret), so this is only
 * ever computed server-side. `id` is kept so a template's `mcpServerIds` can
 * be mapped back to a server when scaffolding a project. */
export interface MaterializedMcpServer {
	headers: Record<string, string>;
	id: string;
	name: string;
	url: string;
}

/** One coding standard, trimmed to what the CLAUDE.md managed block needs. */
export interface MaterializedStandard {
	body: string;
	enabled: boolean;
	sortOrder: number;
	title: string;
}

/** A reusable project scaffold, forwarded verbatim for the CLI's
 * `applyTemplate`. */
export interface MaterializedTemplate {
	claudeMd: string | null;
	description: string | null;
	id: string;
	mcpServerIds: string[];
	name: string;
	scaffold: { dirs: string[]; files: { content: string; path: string }[] };
}

/** Everything a `agent-cli sync` needs to land a Profile idempotently. */
export interface ProfileBundle {
	mcpServers: MaterializedMcpServer[];
	skills: MaterializedSkill[];
	standards: MaterializedStandard[];
	templates: MaterializedTemplate[];
	version: number;
}

async function resolveSkills(
	context: Context,
	userId: string
): Promise<MaterializedSkill[]> {
	const rows = await context.services.stores.skill.listByUser(userId);
	return rows.map((row) => ({
		description: row.description ?? "",
		instructions: row.instructions ?? "",
		name: row.name,
	}));
}

async function resolveMcpServers(
	context: Context,
	userId: string
): Promise<MaterializedMcpServer[]> {
	const rows = await context.services.stores.mcpServer.listByUser(userId);
	return Promise.all(
		rows.map(async (row): Promise<MaterializedMcpServer> => {
			const authHeader = await context.services.stores.mcpServer.getAuthHeader(
				row.id
			);
			const headers: Record<string, string> = authHeader
				? { Authorization: authHeader }
				: {};
			return { headers, id: row.id, name: row.name, url: row.url };
		})
	);
}

/** Assembles the read-only bundle for `userId`: the Profile (version +
 * standards + templates) plus the user's resolved skills and MCP servers. */
export async function resolveProfileBundle(
	context: Context,
	userId: string
): Promise<ProfileBundle> {
	const profile = await context.services.stores.profile.getProfile(userId);
	const [skills, mcpServers] = await Promise.all([
		resolveSkills(context, userId),
		resolveMcpServers(context, userId),
	]);
	return {
		mcpServers,
		skills,
		standards: profile.standards.map((standard) => ({
			body: standard.body,
			enabled: standard.enabled,
			sortOrder: standard.sortOrder,
			title: standard.title,
		})),
		templates: profile.templates.map((template) => ({
			claudeMd: template.claudeMd,
			description: template.description,
			id: template.id,
			mcpServerIds: template.mcpServerIds,
			name: template.name,
			scaffold: template.scaffold,
		})),
		version: profile.version,
	};
}
