import type {
	BridgeTokenStore,
	EmbeddingClient,
	MemoryItemRow,
	MemoryItemStore,
	MemoryRow,
	MemoryScope,
	MemoryStore,
} from "@better-agent/agent/ports";
import type { ProjectStore } from "@better-agent/agent/project-ports";
import {
	embedAndAddItem,
	embedAndSearchItems,
} from "@better-agent/api/routers/memory-support";
import {
	DEFAULT_K,
	MAX_IMPORTANCE,
	MAX_K,
	MIN_IMPORTANCE,
} from "./memory-mcp-tool-defs";

// The memory MCP tool implementations, split from memory-mcp-tool-defs.ts (the
// schemas) and memory-mcp.ts (the JSON-RPC + auth plumbing) so each file stays
// under the per-file line cap. Both tools are scoped to the authenticated
// bridge token: memory_search reads across every assigned memory, memory_add
// writes only through a link whose role is 'read_write'.
//
// DP2 scope: the connection may carry a project context (the projectId the CLI
// bound this session to — see memory-mcp.ts). When present, memory_search only
// surfaces global memories plus the CURRENT project's memories (never another
// project's), and memory_add defaults to writing the current project's memory;
// an explicit `scope:"global"` argument overrides that. With no project
// context every read/write falls back to global memories only.

// The narrow slice of the server's services this endpoint needs — the full
// AgentServices object satisfies it structurally, and tests can wire just
// these stores plus the fake embedding client.
export interface MemoryMcpServices {
	embeddingClient: EmbeddingClient | null;
	stores: {
		bridgeToken: Pick<BridgeTokenStore, "findByHash">;
		memory: Pick<MemoryStore, "getMany" | "listTokenMemories">;
		memoryItem: Pick<MemoryItemStore, "add" | "search">;
		project: Pick<ProjectStore, "getById">;
	};
}

export function toolText(text: string, isError = false) {
	return { content: [{ type: "text", text }], isError };
}

function str(args: Record<string, unknown>, key: string): string {
	const value = args[key];
	return typeof value === "string" ? value : "";
}

function num(args: Record<string, unknown>, key: string): number | undefined {
	const value = args[key];
	return typeof value === "number" ? value : undefined;
}

function scopeArg(args: Record<string, unknown>): MemoryScope | undefined {
	const value = args.scope;
	return value === "global" || value === "project" ? value : undefined;
}

function clampK(k: number | undefined): number {
	if (k === undefined || Number.isNaN(k)) {
		return DEFAULT_K;
	}
	return Math.min(Math.max(Math.trunc(k), 1), MAX_K);
}

function clampImportance(value: number | undefined): number | undefined {
	return value === undefined || Number.isNaN(value)
		? undefined
		: Math.min(Math.max(value, MIN_IMPORTANCE), MAX_IMPORTANCE);
}

// A memory is in scope for a session when it is global, or it is a project
// memory bound to the session's current project — never another project's.
function inScope(row: MemoryRow, projectContext: string | null): boolean {
	if (row.scope === "global") {
		return true;
	}
	return projectContext !== null && row.projectId === projectContext;
}

function formatItem(item: MemoryItemRow, names: Map<string, string>): string {
	const name = names.get(item.memoryId) ?? "memory";
	return `[${name}] (importance ${item.importance}) ${item.content}`;
}

// The token's assigned memory rows, hydrated to full rows so their scope +
// project binding can be filtered on. Optionally narrowed to writable links.
async function assignedRows(
	services: MemoryMcpServices,
	tokenId: string,
	writableOnly: boolean
): Promise<MemoryRow[]> {
	const links = await services.stores.memory.listTokenMemories(tokenId);
	const kept = writableOnly
		? links.filter((link) => link.role === "read_write")
		: links;
	if (kept.length === 0) {
		return [];
	}
	return services.stores.memory.getMany(kept.map((link) => link.memoryId));
}

export async function runSearch(
	services: MemoryMcpServices,
	tokenId: string,
	projectContext: string | null,
	args: Record<string, unknown>
) {
	const query = str(args, "query").trim();
	if (!query) {
		return toolText("memory_search needs a non-empty `query`.", true);
	}
	const client = services.embeddingClient;
	if (!client) {
		return toolText("Embedding provider not configured on the server.", true);
	}
	const rows = await assignedRows(services, tokenId, false);
	if (rows.length === 0) {
		return toolText("No memories are assigned to this agent.");
	}
	const visible = rows.filter((row) => inScope(row, projectContext));
	if (visible.length === 0) {
		return toolText("No matching memory items.");
	}
	const items = await embedAndSearchItems(client, services.stores.memoryItem, {
		query,
		memoryIds: visible.map((row) => row.id),
		k: clampK(num(args, "k")),
	});
	if (items.length === 0) {
		return toolText("No matching memory items.");
	}
	const names = new Map(visible.map((row) => [row.id, row.name]));
	return {
		content: items.map((item) => ({
			type: "text",
			text: formatItem(item, names),
		})),
		isError: false,
	};
}

type WritableTarget = { memoryId: string; name: string } | { error: string };

function noWritableError(scope: MemoryScope): string {
	if (scope === "project") {
		return (
			"This agent has no writable memory for the current project. Ask the " +
			'owner to assign one scoped to this project (or pass scope:"global").'
		);
	}
	return (
		"This agent has no writable global memory. Ask the owner to assign one " +
		"with the read_write role."
	);
}

// Picks the memory a memory_add lands in among the writable memories that match
// the resolved scope: the single one when there is exactly one, else the one
// matching `memory_name` — every other case is an actionable error listing the
// writable options by name.
async function resolveWritable(
	services: MemoryMcpServices,
	tokenId: string,
	requestedName: string,
	scope: MemoryScope,
	projectContext: string | null
): Promise<WritableTarget> {
	const rows = (await assignedRows(services, tokenId, true)).filter((row) =>
		scope === "project"
			? row.scope === "project" && row.projectId === projectContext
			: row.scope === "global"
	);
	if (rows.length === 0) {
		return { error: noWritableError(scope) };
	}
	const options = rows.map((row) => row.name).join(", ");
	if (requestedName) {
		const match = rows.find((row) => row.name === requestedName);
		return match
			? { memoryId: match.id, name: match.name }
			: {
					error: `No writable memory named "${requestedName}". Writable memories: ${options}.`,
				};
	}
	const first = rows[0];
	if (rows.length === 1 && first) {
		return { memoryId: first.id, name: first.name };
	}
	return {
		error: `Multiple writable memories are assigned — pass memory_name to pick one of: ${options}.`,
	};
}

// The scope a memory_add lands in: an explicit `scope` argument wins, else the
// project when the session is bound to one, else global.
function resolveAddScope(
	args: Record<string, unknown>,
	projectContext: string | null
): MemoryScope {
	return scopeArg(args) ?? (projectContext ? "project" : "global");
}

export async function runAdd(
	services: MemoryMcpServices,
	tokenId: string,
	projectContext: string | null,
	args: Record<string, unknown>
) {
	const content = str(args, "content").trim();
	if (!content) {
		return toolText("memory_add needs non-empty `content`.", true);
	}
	const client = services.embeddingClient;
	if (!client) {
		return toolText("Embedding provider not configured on the server.", true);
	}
	const scope = resolveAddScope(args, projectContext);
	if (scope === "project" && projectContext === null) {
		return toolText(
			'scope:"project" needs a project session — this connection has none. ' +
				'Save it globally with scope:"global" instead.',
			true
		);
	}
	const target = await resolveWritable(
		services,
		tokenId,
		str(args, "memory_name").trim(),
		scope,
		projectContext
	);
	if ("error" in target) {
		return toolText(target.error, true);
	}
	const item = await embedAndAddItem(client, services.stores.memoryItem, {
		memoryId: target.memoryId,
		content,
		importance: clampImportance(num(args, "importance")),
		// MCP-added items are agent-authored: of the schema's source union
		// ('user' | 'extracted' | 'reflection'), 'extracted' is the
		// agent-originated one — 'user' stays reserved for human-curated
		// entries from the web UI.
		source: "extracted",
	});
	return toolText(`Saved to memory "${target.name}" (item ${item.id}).`);
}
