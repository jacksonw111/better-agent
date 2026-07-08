import { describe, expect, it } from "vitest";
import { buildApp } from "./app";

describe("finance-mcp app", () => {
	it("responds to health check", async () => {
		const app = buildApp();
		const res = await app.request("/");
		expect(res.status).toBe(200);
		expect(await res.text()).toBe("better-agent-finance-mcp OK");
	});

	it("GET /api/quote returns a parsed quote", async () => {
		const app = buildApp();
		// rest.ts uses the real getQuote which calls global fetch; stub it.
		// The stub feeds UTF-8 bytes but getQuote decodes as GBK, which
		// garbles the multibyte `name` field — assert numeric fields instead.
		const SH =
			'v_sh600000="1~浦发银行~600000~9.00~8.89~8.85~544687~323481~221557~9.00~1384~8.99~2223~8.98~911~8.97~602~8.96~374~9.01~655~9.02~17648~9.03~10161~9.04~6039~9.05~10338~~20260708161454~0.11~1.24~9.03~8.79~~";';
		const orig = globalThis.fetch;
		globalThis.fetch = (async () =>
			new Response(new TextEncoder().encode(SH))) as typeof fetch;
		try {
			const res = await app.request("/api/quote?symbol=600000.SH");
			expect(res.status).toBe(200);
			const body = (await res.json()) as { last: number; symbol: string };
			expect(body.last).toBe(9.0);
			expect(body.symbol).toBe("600000.SH");
		} finally {
			globalThis.fetch = orig;
		}
	});
});
