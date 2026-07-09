import { describe, expect, it } from "vitest";
import { buildApp } from "./app";

const NOT_FOUND = 404;
const UNAUTHORIZED = 401;
const OK = 200;

function stubEmptyFetch(): typeof fetch {
	return (async () =>
		new Response(new TextEncoder().encode(""))) as typeof fetch;
}

describe("finance-mcp auth gate: blocked without a token", () => {
	it("rejects a protected request with no token when API_TOKEN is set", async () => {
		const app = buildApp();
		const res = await app.request(
			"/api/quote?symbol=600000.SH",
			{},
			{ API_TOKEN: "secret123" }
		);
		expect(res.status).toBe(UNAUTHORIZED);
		const body = (await res.json()) as { error: string };
		expect(body.error).toBe("unauthorized");
	});

	it("rejects an unknown protected path before it would 404", async () => {
		const app = buildApp();
		const res = await app.request(
			"/api/does-not-exist",
			{},
			{ API_TOKEN: "secret123" }
		);
		expect(res.status).not.toBe(NOT_FOUND);
		expect(res.status).toBe(UNAUTHORIZED);
	});
});

describe("finance-mcp auth gate: accepted token sources", () => {
	it("accepts a matching Authorization bearer token", async () => {
		const app = buildApp();
		const orig = globalThis.fetch;
		globalThis.fetch = stubEmptyFetch();
		try {
			const res = await app.request(
				"/api/quote?symbol=600000.SH",
				{ headers: { Authorization: "Bearer secret123" } },
				{ API_TOKEN: "secret123" }
			);
			expect(res.status).not.toBe(UNAUTHORIZED);
		} finally {
			globalThis.fetch = orig;
		}
	});

	it("accepts a matching x-api-token header", async () => {
		const app = buildApp();
		const orig = globalThis.fetch;
		globalThis.fetch = stubEmptyFetch();
		try {
			const res = await app.request(
				"/api/quote?symbol=600000.SH",
				{ headers: { "x-api-token": "secret123" } },
				{ API_TOKEN: "secret123" }
			);
			expect(res.status).not.toBe(UNAUTHORIZED);
		} finally {
			globalThis.fetch = orig;
		}
	});

	it("accepts a matching ?token= query param", async () => {
		const app = buildApp();
		const orig = globalThis.fetch;
		globalThis.fetch = stubEmptyFetch();
		try {
			const res = await app.request(
				"/api/quote?symbol=600000.SH&token=secret123",
				{},
				{ API_TOKEN: "secret123" }
			);
			expect(res.status).not.toBe(UNAUTHORIZED);
		} finally {
			globalThis.fetch = orig;
		}
	});
});

describe("finance-mcp auth gate: exemptions", () => {
	it("lets OPTIONS preflight through even without a token", async () => {
		const app = buildApp();
		const res = await app.request(
			"/api/quote",
			{
				method: "OPTIONS",
				headers: {
					Origin: "https://example.com",
					"Access-Control-Request-Method": "GET",
				},
			},
			{ API_TOKEN: "secret123" }
		);
		expect(res.status).not.toBe(UNAUTHORIZED);
	});

	it("keeps GET / open even when API_TOKEN is set", async () => {
		const app = buildApp();
		const res = await app.request("/", {}, { API_TOKEN: "secret123" });
		expect(res.status).toBe(OK);
	});

	it("stays open (no 401) when API_TOKEN is unset", async () => {
		const app = buildApp();
		const orig = globalThis.fetch;
		globalThis.fetch = stubEmptyFetch();
		try {
			const res = await app.request("/api/quote?symbol=600000.SH", {}, {});
			expect(res.status).not.toBe(UNAUTHORIZED);
		} finally {
			globalThis.fetch = orig;
		}
	});
});
