import type {
	BridgeTokenStore,
	EmbeddingClient,
	MemoryItemRow,
	MemoryItemStore,
	MemoryStore,
} from "@better-agent/agent/ports";
import {
	embedAndAddItem,
	embedAndSearchItems,
} from "@better-agent/api/routers/memory-support";

// The memory MCP tools (defs + implementations), split out of memory-mcp.ts
// (which keeps the JSON-RPC + auth plumbing) so both files stay under the
// per-file line cap — mirroring apps/mcp's x-tool-defs.ts/mcp-server.ts split.
// Both tools are scoped to the authenticated bridge token: memory_search reads
// across every assigned memory, memory_add writes only through a link whose
// role is 'read_write'.

const DEFAULT_K = 5;
const MAX_K = 20;
const MIN_IMPORTANCE = 0;
const MAX_IMPORTANCE = 1;

// The narrow slice of the server's services this endpoint needs — the full
// AgentServices object satisfies it structurally, and tests can wire just
// these three stores plus the fake embedding client.
export interface MemoryMcpServices {
	embeddingClient: EmbeddingClient | null;
	stores: {
		bridgeToken: Pick<BridgeTokenStore, "findByHash">;
		memory: Pick<MemoryStore, "get" | "listTokenMemories">;
		memoryItem: Pick<MemoryItemStore, "add" | "search">;
	};
}

export const MEMORY_TOOLS = [
	{
		name: "memory_search",
		description:
			"Search the memories assigned to this agent for relevant saved facts. " +
			"Use it before answering anything that could depend on stored knowledge or preferences.",
		inputSchema: {
			type: "object",
			properties: {
				query: { type: "string", description: "What to look up." },
				k: {
					type: "number",
					description: `How many items to return (default ${DEFAULT_K}, max ${MAX_K}).`,
				},
			},
			required: ["query"],
			additionalProperties: false,
		},
	},
	{
		name: "memory_add",
		description:
			"Save a new fact into one of this agent's writable memories. " +
			"Requires a memory assigned with the read_write role.",
		inputSchema: {
			type: "object",
			properties: {
				content: { type: "string", description: "The fact to remember." },
				importance: {
					type: "number",
					description: "How important the fact is, 0-1 (default 0.5).",
				},
				memory_name: {
					type: "string",
					description:
						"Which memory to write to — only needed when several writable memories are assigned.",
				},
			},
			required: ["content"],
			additionalProperties: false,
		},
	},
] as const;

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

async function memoryNames(
	services: MemoryMcpServices,
	memoryIds: string[]
): Promise<Map<string, string>> {
	const unique = [...new Set(memoryIds)];
	const entries = await Promise.all(
		unique.map(async (id) => {
			const memory = await services.stores.memory.get(id);
			return [id, memory?.name ?? "memory"] as const;
		})
	);
	return new Map(entries);
}

function formatItem(item: MemoryItemRow, names: Map<string, string>): string {
	const name = names.get(item.memoryId) ?? "memory";
	return `[${name}] (importance ${item.importance}) ${item.content}`;
}

export async function runSearch(
	services: MemoryMcpServices,
	tokenId: string,
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
	const links = await services.stores.memory.listTokenMemories(tokenId);
	if (links.length === 0) {
		return toolText("No memories are assigned to this agent.");
	}
	const items = await embedAndSearchItems(client, services.stores.memoryItem, {
		query,
		memoryIds: links.map((link) => link.memoryId),
		k: clampK(num(args, "k")),
	});
	if (items.length === 0) {
		return toolText("No matching memory items.");
	}
	const names = await memoryNames(
		services,
		items.map((item) => item.memoryId)
	);
	return {
		content: items.map((item) => ({
			type: "text",
			text: formatItem(item, names),
		})),
		isError: false,
	};
}

type WritableTarget = { memoryId: string; name: string } | { error: string };

// Picks the memory a memory_add lands in: the single read_write link when
// there is exactly one, else the one matching `memory_name` — every other
// case is an actionable error listing the writable options by name.
async function resolveWritable(
	services: MemoryMcpServices,
	tokenId: string,
	requestedName: string
): Promise<WritableTarget> {
	const links = await services.stores.memory.listTokenMemories(tokenId);
	const writable = links.filter((link) => link.role === "read_write");
	if (writable.length === 0) {
		return {
			error:
				"This agent has no writable memory. Ask the owner to assign one with the read_write role.",
		};
	}
	const names = await memoryNames(
		services,
		writable.map((link) => link.memoryId)
	);
	const options = [...names.values()].join(", ");
	if (requestedName) {
		for (const [memoryId, name] of names) {
			if (name === requestedName) {
				return { memoryId, name };
			}
		}
		return {
			error: `No writable memory named "${requestedName}". Writable memories: ${options}.`,
		};
	}
	const first = writable[0];
	if (writable.length === 1 && first) {
		return {
			memoryId: first.memoryId,
			name: names.get(first.memoryId) ?? "memory",
		};
	}
	return {
		error: `Multiple writable memories are assigned — pass memory_name to pick one of: ${options}.`,
	};
}

export async function runAdd(
	services: MemoryMcpServices,
	tokenId: string,
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
	const target = await resolveWritable(
		services,
		tokenId,
		str(args, "memory_name").trim()
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
