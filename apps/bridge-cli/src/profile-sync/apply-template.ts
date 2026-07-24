import { dirname, join } from "node:path";
import type { BundleMcpServer, BundleTemplate } from "./bundle";
import type { SyncFs } from "./fs-ports";
import { buildMemoryEntry, landMcpServers } from "./mcp-land";

// P1-C (DP3): scaffolds a project from a Profile template into `targetDir` —
// creates the template's dirs, writes its seed files, drops the project-layer
// `CLAUDE.md` increment, and writes a project `.mcp.json` carrying the
// template's MCP servers + the memory entry bound to this project (P1-B's
// `x-better-agent-project-id`). The web "new project" wiring calls this later;
// this slice ships the capability + its tests.

export interface ApplyTemplateDeps {
	/** Bridge token for the project memory entry's Bearer auth. */
	bridgeToken?: string;
	fs: SyncFs;
	/** The user's full resolved MCP set — the template's `mcpServerIds` are
	 * mapped against these by id; unknown/deleted ids are silently skipped. */
	mcpServers: BundleMcpServer[];
	/** The project this scaffold belongs to — binds the memory MCP entry. */
	projectId?: string;
	serverUrl: string;
	targetDir: string;
	template: BundleTemplate;
}

async function writeFileEnsuringDir(
	fs: SyncFs,
	path: string,
	content: string
): Promise<void> {
	await fs.mkdir(dirname(path));
	await fs.writeFile(path, content);
}

function templateMcpServers(deps: ApplyTemplateDeps): BundleMcpServer[] {
	const byId = new Map(deps.mcpServers.map((server) => [server.id, server]));
	const resolved: BundleMcpServer[] = [];
	for (const id of deps.template.mcpServerIds) {
		const server = byId.get(id);
		if (server) {
			resolved.push(server);
		}
	}
	return resolved;
}

/** Lands the project `.mcp.json` (template servers + memory entry) at
 * `targetDir/.mcp.json`. Nothing pre-exists in a fresh scaffold, so the
 * previous-names manifest is empty. */
async function writeProjectMcp(deps: ApplyTemplateDeps): Promise<void> {
	const memory = buildMemoryEntry(
		deps.serverUrl,
		deps.bridgeToken,
		deps.projectId
	);
	await landMcpServers(
		deps.fs,
		{ betterAgentDir: deps.targetDir, claudeDir: deps.targetDir },
		templateMcpServers(deps),
		memory,
		[]
	);
}

/** Scaffolds `template` into `targetDir` (see the file header). */
export async function applyTemplate(deps: ApplyTemplateDeps): Promise<void> {
	const { fs, targetDir, template } = deps;
	for (const dir of template.scaffold.dirs) {
		await fs.mkdir(join(targetDir, dir));
	}
	for (const file of template.scaffold.files) {
		await writeFileEnsuringDir(fs, join(targetDir, file.path), file.content);
	}
	if (template.claudeMd) {
		await writeFileEnsuringDir(
			fs,
			join(targetDir, "CLAUDE.md"),
			template.claudeMd
		);
	}
	await writeProjectMcp(deps);
}
