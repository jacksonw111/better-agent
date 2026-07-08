import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { createPdfProxyHandler } from "./pdf-proxy";

function appWith(fetchImpl: typeof fetch): Hono {
	const app = new Hono();
	app.get("/pdf", createPdfProxyHandler(fetchImpl));
	return app;
}

describe("pdf proxy", () => {
	it("rejects a non-allowed host", async () => {
		const app = appWith((async () => new Response("nope")) as typeof fetch);
		const res = await app.request("/pdf?url=https://evil.com/x.pdf");
		expect(res.status).toBe(400);
	});

	it("proxies an allowed pdf.dfcfw.com url and sets cache-control", async () => {
		const captured: { url?: string; referer?: string } = {};
		const fetchImpl = ((url: string, init?: RequestInit) => {
			captured.url = url;
			captured.referer = new Headers(init?.headers).get("Referer") ?? undefined;
			return Promise.resolve(
				new Response("%PDF-1.4", {
					headers: { "content-type": "application/pdf" },
				})
			);
		}) as typeof fetch;
		const app = appWith(fetchImpl);
		const res = await app.request(
			"/pdf?url=https://pdf.dfcfw.com/pdf/H2_ABC_1.pdf"
		);
		expect(res.status).toBe(200);
		expect(res.headers.get("cache-control")).toBe("public, max-age=300");
		expect(captured.referer).toBe("https://data.eastmoney.com/");
	});
});
