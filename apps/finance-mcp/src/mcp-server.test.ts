import { describe, expect, it } from "vitest";
import { handleMessage } from "./mcp-server";

const call = (message: Parameters<typeof handleMessage>[0]) =>
	handleMessage(message, {});

describe("mcp handshake", () => {
	it("initialize returns protocol + serverInfo", async () => {
		const res = await call({ jsonrpc: "2.0", id: 1, method: "initialize" });
		expect(res).not.toBeNull();
		const result = (
			res as {
				result: { protocolVersion: string; serverInfo: { name: string } };
			}
		).result;
		expect(result.protocolVersion).toBe("2025-06-18");
		expect(result.serverInfo.name).toBe("better-agent-finance-mcp");
	});

	it("tools/list returns an array", async () => {
		const res = await call({ jsonrpc: "2.0", id: 2, method: "tools/list" });
		const tools = (res as { result: { tools: unknown[] } }).result.tools;
		expect(Array.isArray(tools)).toBe(true);
	});

	it("notifications return null (no body)", async () => {
		const res = await call({
			jsonrpc: "2.0",
			method: "notifications/initialized",
		});
		expect(res).toBeNull();
	});

	it("unknown tool returns isError", async () => {
		const res = await call({
			jsonrpc: "2.0",
			id: 3,
			method: "tools/call",
			params: { name: "finance_nope", arguments: {} },
		});
		const result = (res as { result: { isError: boolean } }).result;
		expect(result.isError).toBe(true);
	});
});
