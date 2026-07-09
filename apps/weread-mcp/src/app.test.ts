import { describe, expect, it } from "vitest";
import { buildApp } from "./app";

describe("weread-mcp app", () => {
	it("responds to health check", async () => {
		const app = buildApp();
		const res = await app.request("/");
		expect(res.status).toBe(200);
		const body = (await res.json()) as {
			service: string;
			status: string;
			tools: number;
		};
		expect(body.service).toBe("better-agent-weread-mcp");
		expect(body.status).toBe("ok");
		expect(body.tools).toBe(15);
	});

	it("MCP initialize handshake", async () => {
		const app = buildApp();
		const res = await app.request("/mcp", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				jsonrpc: "2.0",
				id: 1,
				method: "initialize",
			}),
		});
		expect(res.status).toBe(200);
		const body = (await res.json()) as {
			result: {
				protocolVersion: string;
				serverInfo: { name: string };
			};
		};
		expect(body.result.protocolVersion).toBe("2025-06-18");
		expect(body.result.serverInfo.name).toBe("better-agent-weread-mcp");
	});

	it("MCP tools/list returns 15 tools", async () => {
		const app = buildApp();
		const res = await app.request("/mcp", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				jsonrpc: "2.0",
				id: 2,
				method: "tools/list",
			}),
		});
		expect(res.status).toBe(200);
		const body = (await res.json()) as {
			result: { tools: { name: string }[] };
		};
		expect(body.result.tools.length).toBe(15);
	});

	it("MCP tools/call returns tool error when WEREAD_API_KEY unset", async () => {
		const app = buildApp();
		const res = await app.request("/mcp", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				jsonrpc: "2.0",
				id: 3,
				method: "tools/call",
				params: { name: "weread_shelf", arguments: {} },
			}),
		});
		expect(res.status).toBe(200);
		const body = (await res.json()) as {
			result: { content: { text: string }[]; isError: boolean };
		};
		expect(body.result.isError).toBe(true);
		const text = body.result.content[0]?.text ?? "";
		expect(text).toContain("x-weread-key");
	});

	it("REST /api/shelf returns 503 when WEREAD_API_KEY unset", async () => {
		const app = buildApp();
		const res = await app.request("/api/shelf");
		expect(res.status).toBe(503);
	});

	it("returns 400 on malformed JSON body", async () => {
		const app = buildApp();
		const res = await app.request("/mcp", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: "not json",
		});
		expect(res.status).toBe(400);
	});
});

describe("weread-mcp app CORS", () => {
	it("GET /api/search sends CORS headers for browser origins", async () => {
		const app = buildApp();
		const res = await app.request("/api/search?keyword=x", {
			headers: { Origin: "https://example.com" },
		});
		expect(res.headers.get("access-control-allow-origin")).toBeTruthy();
	});

	it("OPTIONS /api/search preflight returns 204 with CORS headers", async () => {
		const app = buildApp();
		const res = await app.request("/api/search", {
			method: "OPTIONS",
			headers: {
				Origin: "https://example.com",
				"Access-Control-Request-Method": "GET",
			},
		});
		expect(res.status).toBe(204);
		expect(res.headers.get("access-control-allow-origin")).toBeTruthy();
	});
});
