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
// Our own MCP worker's name; same-account worker-to-worker fetches over the
// public URL are blocked by Cloudflare (error 1042), so those route through a
// service binding instead (see buildMcpResolver).
const INTERNAL_MCP_HOST_MARKER = "better-agent-mcp";

// A Cloudflare service binding (same-account worker-to-worker fetch).
export interface ServiceBinding {
	fetch(request: Request): Promise<Response>;
}

type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

interface McpTarget {
	authHeader: string | null;
	/** Overrides the transport's fetch (used to route through a binding). */
	fetchImpl?: FetchLike;
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
// (a single POST handshake on Streamable HTTP) and per-call connections avoid
// stale-session state across Worker isolates.
async function withClient<T>(
	target: McpTarget,
	fn: (client: Client) => Promise<T>
): Promise<T> {
	const transport = new StreamableHTTPClientTransport(new URL(target.url), {
		requestInit: target.authHeader
			? { headers: { authorization: target.authHeader } }
			: undefined,
		...(target.fetchImpl ? { fetch: target.fetchImpl } : {}),
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

// Routes fetches through the service binding: same-account worker-to-worker
// public-URL fetches are blocked (CF 1042), so our own MCP worker is reached
// via the binding, which ignores the hostname and hits the bound worker.
function bindingFetch(binding: ServiceBinding): FetchLike {
	return (input, init) => binding.fetch(new Request(input, init));
}

function isInternalMcpHost(url: string): boolean {
	try {
		return new URL(url).host.includes(INTERNAL_MCP_HOST_MARKER);
	} catch {
		return false;
	}
}

function resolveFetchImpl(
	url: string,
	binding: ServiceBinding | undefined
): FetchLike | undefined {
	return binding && isInternalMcpHost(url) ? bindingFetch(binding) : undefined;
}

/** Resolve a stored MCP server id to a connected service (null if missing).
 * `internalBinding` reaches our own MCP worker without hitting CF error 1042. */
export function buildMcpResolver(
	store: McpServerStore,
	internalBinding?: ServiceBinding
) {
	return async (serverId: string): Promise<McpService | null> => {
		const row = await store.getById(serverId);
		if (!row) {
			return null;
		}
		const authHeader = await store.getAuthHeader(serverId);
		return createMcpService({
			url: row.url,
			authHeader,
			fetchImpl: resolveFetchImpl(row.url, internalBinding),
		});
	};
}
