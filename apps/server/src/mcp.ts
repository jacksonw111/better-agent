import type { McpServerStore } from "@better-agent/agent/ports";
import type {
	McpService,
	McpToolMeta,
} from "@better-agent/agent/tool/mcp-tools";
import type { ExecuteResult, JsonSchema } from "@better-agent/agent/tool/types";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { log } from "evlog";

const MCP_TIMEOUT_MS = 45_000;
const CLIENT_INFO = { name: "better-agent", version: "1.0.0" };

interface McpTarget {
	authHeader: string | null;
	url: string;
}

function withTimeout<T>(fn: () => Promise<T>): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		const timer = setTimeout(
			() => reject(new Error(`timed out after ${MCP_TIMEOUT_MS}ms`)),
			MCP_TIMEOUT_MS
		);
		fn().then(
			(value) => {
				clearTimeout(timer);
				resolve(value);
			},
			(error) => {
				clearTimeout(timer);
				reject(error);
			}
		);
	});
}

// One connection per operation: connect → run → close. MCP sessions are cheap
// (a single POST handshake on Streamable HTTP) and per-call connections keep the
// implementation simple with no long-lived session state to reap.
async function withClient<T>(
	target: McpTarget,
	fn: (client: Client) => Promise<T>
): Promise<T> {
	const transport = new StreamableHTTPClientTransport(new URL(target.url), {
		requestInit: target.authHeader
			? { headers: { authorization: target.authHeader } }
			: undefined,
	});
	const client = new Client(CLIENT_INFO);
	await client.connect(transport);
	try {
		return await fn(client);
	} finally {
		await client.close().catch(() => undefined);
	}
}

async function withLog<T>(op: string, fn: () => Promise<T>): Promise<T> {
	try {
		return await withTimeout(fn);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		log.error("mcp", `${op} failed: ${message}`);
		throw error;
	}
}

// MCP tool results are content blocks; flatten the text parts for the model.
function contentToOutput(result: {
	content?: unknown;
	isError?: boolean;
}): ExecuteResult {
	const blocks = Array.isArray(result.content) ? result.content : [];
	const text = blocks
		.map((block) => {
			const b = block as { type?: string; text?: string };
			return b.type === "text" && typeof b.text === "string"
				? b.text
				: JSON.stringify(block);
		})
		.join("\n");
	return { output: text, isError: result.isError === true };
}

function createMcpService(target: McpTarget): McpService {
	return {
		listTools() {
			return withLog("listTools", () =>
				withClient(target, async (client) => {
					const res = await client.listTools();
					return res.tools.map(
						(tool): McpToolMeta => ({
							name: tool.name,
							description: tool.description ?? "",
							parameters: (tool.inputSchema ?? {
								type: "object",
							}) as JsonSchema,
						})
					);
				})
			);
		},
		execute({ toolName, args }) {
			return withLog("execute", () =>
				withClient(target, async (client) => {
					const result = await client.callTool({
						name: toolName,
						arguments: (args ?? {}) as Record<string, unknown>,
					});
					return contentToOutput(
						result as { content?: unknown; isError?: boolean }
					);
				})
			);
		},
	};
}

/** Resolve a stored MCP server id to a connected service (null if missing). */
export function buildMcpResolver(store: McpServerStore) {
	return async (serverId: string): Promise<McpService | null> => {
		const row = await store.getById(serverId);
		if (!row) {
			return null;
		}
		const authHeader = await store.getAuthHeader(serverId);
		return createMcpService({
			url: row.url,
			authHeader,
		});
	};
}
