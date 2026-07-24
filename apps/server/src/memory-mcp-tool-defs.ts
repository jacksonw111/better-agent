// The memory MCP tool schemas + shared numeric bounds, split out of
// memory-mcp-tools.ts (which keeps the implementations) so both stay under the
// per-file line cap — mirroring apps/mcp's x-tool-defs.ts/mcp-server.ts split.

export const DEFAULT_K = 5;
export const MAX_K = 20;
export const MIN_IMPORTANCE = 0;
export const MAX_IMPORTANCE = 1;

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
			"Requires a memory assigned with the read_write role. In a project " +
			"session the fact is saved to the project's memory by default; pass " +
			'scope:"global" to save it to the shared global memory instead.',
		inputSchema: {
			type: "object",
			properties: {
				content: { type: "string", description: "The fact to remember." },
				importance: {
					type: "number",
					description: "How important the fact is, 0-1 (default 0.5).",
				},
				scope: {
					type: "string",
					enum: ["global", "project"],
					description:
						'Where to save it: "project" (this session\'s project) or ' +
						'"global" (shared everywhere). Defaults to the project when the ' +
						"session is bound to one, else global.",
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
