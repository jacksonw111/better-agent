import { join } from "node:path";
import type { BundleMcpServer } from "./bundle";
import type { SyncFs, SyncRoots } from "./fs-ports";

// P1-C (DP3): lands the user's MCP set + the platform memory server into
// `~/.claude/.mcp.json` — the name→config map (`type: "http"`) claude-code
// reads. Non-destructive like the skills landing: only server names THIS tool
// wrote last time (`previousNames`) are candidates for removal, so an MCP entry
// the user added by hand survives a sync. The memory entry always rides along.

const TRAILING_SLASH = /\/$/;
const MCP_FILE = ".mcp.json";

/** The header binding a project session's memory reads/writes to one project
 * (P1-B, apps/server/src/memory-mcp.ts). Absent on a global/standalone sync. */
const PROJECT_HEADER = "x-better-agent-project-id";

export interface McpServerConfig {
	headers: Record<string, string>;
	type: "http";
	url: string;
}

export interface McpEntry {
	config: McpServerConfig;
	name: string;
}

interface McpJsonFile {
	mcpServers: Record<string, McpServerConfig>;
}

function mcpFilePath(roots: SyncRoots): string {
	return join(roots.claudeDir, MCP_FILE);
}

/**
 * Builds the platform memory-MCP entry. Auth is the caller's bridge token
 * (`bt_…`) as Bearer — the SAME credential apps/server/src/memory-mcp.ts
 * requires. A project session additionally binds it to `projectId` via the
 * `x-better-agent-project-id` header (P1-B); a global/standalone sync omits it,
 * which the server reads as "global-only" context. A memory server with no
 * bridge token still lands (url only) so the entry is discoverable — the CLI
 * fills auth in on the next authed sync.
 */
export function buildMemoryEntry(
	serverUrl: string,
	bridgeToken: string | undefined,
	projectId: string | undefined
): McpEntry {
	const base = serverUrl.replace(TRAILING_SLASH, "");
	const headers: Record<string, string> = {};
	if (bridgeToken) {
		headers.Authorization = `Bearer ${bridgeToken}`;
	}
	if (projectId) {
		headers[PROJECT_HEADER] = projectId;
	}
	return {
		config: { headers, type: "http", url: `${base}/mcp/memory` },
		name: "memory",
	};
}

function serverToConfig(server: BundleMcpServer): McpServerConfig {
	return { headers: server.headers, type: "http", url: server.url };
}

function parseExisting(raw: string | null): McpJsonFile {
	if (raw === null) {
		return { mcpServers: {} };
	}
	try {
		const parsed = JSON.parse(raw) as Partial<McpJsonFile>;
		return { mcpServers: parsed.mcpServers ?? {} };
	} catch {
		// A hand-corrupted file must not sink the sync — start fresh.
		return { mcpServers: {} };
	}
}

/**
 * Merges the user's MCP servers + the memory entry into `.mcp.json`,
 * preserving unmanaged (user-added) entries. Returns the managed names — the
 * next `profile-state.json` manifest.
 */
export async function landMcpServers(
	fs: SyncFs,
	roots: SyncRoots,
	servers: BundleMcpServer[],
	memory: McpEntry,
	previousNames: string[]
): Promise<string[]> {
	const file = parseExisting(await fs.readFile(mcpFilePath(roots)));
	const managed = new Map<string, McpServerConfig>();
	for (const server of servers) {
		managed.set(server.name, serverToConfig(server));
	}
	managed.set(memory.name, memory.config);
	const managedNames = new Set(managed.keys());
	for (const previous of previousNames) {
		if (!managedNames.has(previous)) {
			delete file.mcpServers[previous];
		}
	}
	for (const [name, config] of managed) {
		file.mcpServers[name] = config;
	}
	await fs.mkdir(roots.claudeDir);
	await fs.writeFile(
		mcpFilePath(roots),
		`${JSON.stringify(file, null, "\t")}\n`
	);
	return [...managedNames];
}
