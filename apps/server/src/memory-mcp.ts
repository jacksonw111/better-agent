import { hashToken } from "@better-agent/agent/crypto/auth-tokens";
import { log } from "evlog";
import { Hono } from "hono";
import { MEMORY_TOOLS } from "./memory-mcp-tool-defs";
import {
	type MemoryMcpServices,
	runAdd,
	runSearch,
	toolText,
} from "./memory-mcp-tools";

// Memory MCP server (M1 slice 4, decision B2): a Streamable-HTTP JSON-RPC
// endpoint in stateless JSON mode, mirroring apps/mcp's structure. Local
// agents (claude-code/opencode/pi/codex via the bridge) point at it with the
// bridge token (`bt_…`) they already hold as the Bearer credential — the
// token IS the principal: it resolves (by hash, exactly like the bridge
// plane) to its assigned memories via bridge_token_memories. Lives in
// apps/server (not apps/mcp) because it needs the DB stores and the
// embedding client. Tool defs + implementations are in memory-mcp-tools.ts.

export const MEMORY_MCP_PROTOCOL_VERSION = "2025-06-18";
export const MEMORY_MCP_SERVER_INFO = {
	name: "better-agent-memory",
	version: "0.1.0",
};

const METHOD_NOT_FOUND = -32_601;
const PARSE_ERROR = -32_700;
const HTTP_ACCEPTED = 202;
const HTTP_BAD_REQUEST = 400;
const HTTP_UNAUTHORIZED = 401;
const BEARER_PREFIX = "Bearer ";

interface JsonRpcRequest {
	id?: number | string | null;
	jsonrpc: "2.0";
	method: string;
	params?: Record<string, unknown>;
}

interface JsonRpcResponse {
	error?: { code: number; message: string };
	id: number | string | null;
	jsonrpc: "2.0";
	result?: unknown;
}

function ok(id: JsonRpcResponse["id"], result: unknown): JsonRpcResponse {
	return { jsonrpc: "2.0", id, result };
}

function parseToolParams(params: Record<string, unknown> | undefined): {
	name: string;
	args: Record<string, unknown>;
} {
	const name = typeof params?.name === "string" ? params.name : "";
	const args =
		typeof params?.arguments === "object" && params.arguments !== null
			? (params.arguments as Record<string, unknown>)
			: {};
	return { name, args };
}

async function callTool(
	id: JsonRpcResponse["id"],
	params: Record<string, unknown> | undefined,
	services: MemoryMcpServices,
	principal: Principal
): Promise<JsonRpcResponse> {
	const { name, args } = parseToolParams(params);
	const { tokenId, projectContext } = principal;
	try {
		if (name === "memory_search") {
			return ok(id, await runSearch(services, tokenId, projectContext, args));
		}
		if (name === "memory_add") {
			return ok(id, await runAdd(services, tokenId, projectContext, args));
		}
		return ok(id, toolText(`Unknown tool: ${name}`, true));
	} catch (err) {
		const detail =
			err instanceof Error ? (err.stack ?? err.message) : String(err);
		log.error("memory-mcp", `tool ${name} failed: ${detail}`);
		const message = err instanceof Error ? err.message : String(err);
		return ok(id, toolText(`Memory tool failed: ${message}`, true));
	}
}

// The authenticated caller: the bridge-token principal plus the project this
// connection is scoped to (DP2). `projectContext` is null for a stand-alone
// (non-project) session; when set it has been validated to belong to the
// token's owner.
interface Principal {
	projectContext: string | null;
	tokenId: string;
}

/** Handle one JSON-RPC message; null = notification (no response body). */
export function handleMemoryMcpMessage(
	message: JsonRpcRequest,
	services: MemoryMcpServices,
	principal: Principal
): Promise<JsonRpcResponse | null> {
	const id = message.id ?? null;
	if (message.method.startsWith("notifications/")) {
		return Promise.resolve(null);
	}
	switch (message.method) {
		case "initialize":
			return Promise.resolve(
				ok(id, {
					protocolVersion: MEMORY_MCP_PROTOCOL_VERSION,
					capabilities: { tools: {} },
					serverInfo: MEMORY_MCP_SERVER_INFO,
				})
			);
		case "ping":
			return Promise.resolve(ok(id, {}));
		case "tools/list":
			return Promise.resolve(ok(id, { tools: MEMORY_TOOLS }));
		case "tools/call":
			return callTool(id, message.params, services, principal);
		default:
			return Promise.resolve({
				jsonrpc: "2.0",
				id,
				error: {
					code: METHOD_NOT_FOUND,
					message: `Unknown method: ${message.method}`,
				},
			});
	}
}

// The HTTP header the CLI sets on the memory-MCP connection to bind a project
// session's writes/reads to one project (DP2). Absent = a stand-alone session.
const PROJECT_HEADER = "x-better-agent-project-id";

interface TokenPrincipal {
	tokenId: string;
	userId: string;
}

// Resolves the Bearer credential to a live (non-revoked) bridge token via the
// same hash lookup the bridge plane uses; null = respond 401.
async function resolveTokenPrincipal(
	services: MemoryMcpServices,
	header: string | undefined
): Promise<TokenPrincipal | null> {
	if (!header?.startsWith(BEARER_PREFIX)) {
		return null;
	}
	const token = header.slice(BEARER_PREFIX.length).trim();
	if (token === "") {
		return null;
	}
	const found = await services.stores.bridgeToken.findByHash(hashToken(token));
	if (!found || found.revokedAt) {
		return null;
	}
	return { tokenId: found.id, userId: found.userId };
}

// Validates the connection's project header against the token owner: a project
// scopes reads/writes only when it actually belongs to this user, so a spoofed
// or stale id silently degrades to a stand-alone (global-only) context rather
// than erroring or leaking.
async function resolveProjectContext(
	services: MemoryMcpServices,
	userId: string,
	header: string | undefined
): Promise<string | null> {
	const projectId = header?.trim();
	if (!projectId) {
		return null;
	}
	const project = await services.stores.project.getById(projectId, userId);
	return project ? project.id : null;
}

/** The memory MCP sub-app; mounted at /mcp/memory by the server's buildApp. */
export function buildMemoryMcpApp(services: MemoryMcpServices): Hono {
	const app = new Hono();
	app.get("/", (c) => c.text("better-agent-memory-mcp OK"));
	app.post("/", async (c) => {
		const token = await resolveTokenPrincipal(
			services,
			c.req.header("authorization")
		);
		if (!token) {
			return c.json(
				{ error: "Unauthorized: pass a valid bridge token (bt_…) as Bearer." },
				HTTP_UNAUTHORIZED
			);
		}
		const projectContext = await resolveProjectContext(
			services,
			token.userId,
			c.req.header(PROJECT_HEADER)
		);
		let message: JsonRpcRequest;
		try {
			message = await c.req.json();
		} catch {
			return c.json(
				{
					jsonrpc: "2.0",
					id: null,
					error: { code: PARSE_ERROR, message: "Parse error" },
				},
				HTTP_BAD_REQUEST
			);
		}
		const response = await handleMemoryMcpMessage(message, services, {
			tokenId: token.tokenId,
			projectContext,
		});
		if (response === null) {
			return c.body(null, HTTP_ACCEPTED);
		}
		return c.json(response);
	});
	return app;
}
