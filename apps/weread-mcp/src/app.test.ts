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

	it("MCP tools/call without bearer token returns tool error", async () => {
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
		expect(text).toContain("WeRead API key");
	});

	it("MCP initialize works without auth (handshake needs no key)", async () => {
		const app = buildApp();
		const res = await app.request("/mcp", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				jsonrpc: "2.0",
				id: 9,
				method: "ping",
			}),
		});
		expect(res.status).toBe(200);
	});

	it("REST /api/shelf without bearer returns 503", async () => {
		const app = buildApp();
		const res = await app.request("/api/shelf");
		expect(res.status).toBe(503);
	});

	it("REST /api/shelf forwards bearer token to upstream", async () => {
		const app = buildApp();
		let sentAuth = "";
		const orig = globalThis.fetch;
		globalThis.fetch = (async (_url: RequestInfo | URL, init?: RequestInit) => {
			const h = init?.headers as Record<string, string> | undefined;
			sentAuth = h?.authorization ?? "";
			return Promise.resolve(
				new Response(JSON.stringify({ errcode: 0, books: [] }), {
					headers: { "content-type": "application/json" },
				})
			);
		}) as typeof fetch;
		try {
			const res = await app.request("/api/shelf", {
				headers: { authorization: "Bearer wrk-test-123" },
			});
			expect(res.status).toBe(200);
			expect(sentAuth).toBe("Bearer wrk-test-123");
		} finally {
			globalThis.fetch = orig;
		}
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
