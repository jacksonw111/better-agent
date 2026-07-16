import { log } from "evlog";
import { TOOLS } from "./tool-defs";
// Side-effect import: registers finance_search / finance_research /
// finance_earnings_forecast onto the shared TOOLS/TOOL_NAMES arrays.
import "./tool-defs-research";
// Side-effect import: registers finance_index_quote / finance_commodity onto
// the shared TOOLS/TOOL_NAMES arrays.
import "./tool-defs-market";
// Side-effect import: registers finance_dividends / finance_dragon_tiger /
// finance_top_holders onto the shared TOOLS/TOOL_NAMES arrays.
import "./tool-defs-extra";
// Side-effect import: registers finance_sentiment_trending /
// finance_sentiment_ticker / finance_sentiment_market onto the shared
// TOOLS/TOOL_NAMES arrays.
import "./tool-defs-sentiment";
// Side-effect import: registers finance_margin / finance_divergence onto the
// shared TOOLS/TOOL_NAMES arrays.
import "./tool-defs-signals";
// Side-effect import: registers finance_earnings_preannounce /
// finance_lockup / finance_convertible_bonds / finance_ipo onto the shared
// TOOLS/TOOL_NAMES arrays.
import "./tool-defs-data";
// Side-effect import: registers finance_block_trades /
// finance_insider_trades / finance_suspension onto the shared
// TOOLS/TOOL_NAMES arrays.
import "./tool-defs-events";
// Side-effect imports: register the V6 batch (打板 / 舆情 / A股扩展 /
// 美股增强 + 行业新闻) onto the shared TOOLS/TOOL_NAMES arrays.
import "./tool-defs-limitup";
import "./tool-defs-buzz";
import "./tool-defs-cnx";
import "./tool-defs-global";
// Side-effect import: registers finance_trade_calendar / finance_market_breadth
// (QuantSkills integration Phase 0) onto the shared TOOLS registry.
import "./tool-defs-market-stats";
import { runTool, type ToolEnv, toolText } from "./tools-impl";

// MCP server core (Streamable HTTP, stateless JSON mode): handshake + tool
// dispatch. Feature tasks register tools in tool-defs.ts / tools-impl.ts; this
// module only handles the JSON-RPC envelope.

export const PROTOCOL_VERSION = "2025-06-18";
export const SERVER_INFO = {
	name: "better-agent-finance-mcp",
	version: "0.1.0",
};

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

const METHOD_NOT_FOUND = -32_601;

function ok(id: JsonRpcResponse["id"], result: unknown): JsonRpcResponse {
	return { jsonrpc: "2.0", id, result };
}

function toArgs(
	params: Record<string, unknown> | undefined
): Record<string, unknown> {
	return typeof params?.arguments === "object" && params.arguments !== null
		? (params.arguments as Record<string, unknown>)
		: {};
}

async function callTool(
	id: JsonRpcResponse["id"],
	params: Record<string, unknown> | undefined,
	env: ToolEnv
): Promise<JsonRpcResponse> {
	const name = typeof params?.name === "string" ? params.name : "";
	try {
		return ok(id, await runTool(name, toArgs(params), env));
	} catch (err) {
		log.error(
			"finance-mcp",
			`tool ${name} failed: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`
		);
		const detail = err instanceof Error ? err.message : String(err);
		return ok(id, toolText(`Request failed: ${detail}`, true));
	}
}

/** Handle one JSON-RPC message; null = notification (no response body). */
export function handleMessage(
	message: JsonRpcRequest,
	env: ToolEnv = {}
): Promise<JsonRpcResponse | null> {
	const id = message.id ?? null;
	if (message.method.startsWith("notifications/")) {
		return Promise.resolve(null);
	}
	switch (message.method) {
		case "initialize":
			return Promise.resolve(
				ok(id, {
					protocolVersion: PROTOCOL_VERSION,
					capabilities: { tools: {} },
					serverInfo: SERVER_INFO,
				})
			);
		case "ping":
			return Promise.resolve(ok(id, {}));
		case "tools/list":
			return Promise.resolve(ok(id, { tools: TOOLS }));
		case "tools/call":
			return callTool(id, message.params, env);
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
