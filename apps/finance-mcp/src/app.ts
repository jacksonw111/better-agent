import { Hono } from "hono";
import { cors } from "hono/cors";
import { NotConfiguredError } from "./core/fred/economic";
import { BadSymbolError } from "./core/symbol";
import { handleMessage } from "./mcp-server";
import { createPdfProxyHandler } from "./pdf-proxy";
import { registerRest } from "./rest";
import { TOOLS } from "./tool-defs";
import type { ToolEnv } from "./tools-impl";

// Streamable HTTP endpoint in stateless JSON mode: every POST carries one
// JSON-RPC message; responses come back as application/json (the spec allows
// a plain JSON body instead of an SSE stream). No session state is kept.

const ACCEPTED = 202;
const BAD_REQUEST = 400;
const NOT_CONFIGURED = 503;
const BAD_GATEWAY = 502;
const PARSE_ERROR = -32_700;
const DEBUG_MAX = 900;

// TEMPORARY sector-clist probe — replicates the connector's request so I can see
// the raw push2 response and vary fs/host/fields. Remove after debugging.
async function debugClist(c: {
	req: { query: (k: string) => string | undefined };
	json: (v: unknown) => Response;
}): Promise<Response> {
	const host = c.req.query("host") ?? "1.push2.eastmoney.com";
	const fs = c.req.query("fs") ?? "m:90 t:2 f:!50";
	const fields = c.req.query("fields") ?? "f12,f14,f2,f3";
	const enc = encodeURIComponent(fs).replace(/%20/g, "+");
	const url =
		`https://${host}/api/qt/clist/get?pn=1&pz=5&po=1&np=1` +
		`&ut=bd1d9ddb04089700cf9c27f6f7426281&fltt=2&invt=2&fid=f3&fs=${enc}&fields=${fields}`;
	const res = await fetch(url, {
		headers: { Referer: "https://quote.eastmoney.com/" },
	});
	const body = await res.text();
	return c.json({ url, status: res.status, body: body.slice(0, DEBUG_MAX) });
}

export function buildApp(): Hono {
	const app = new Hono();
	app.use("/api/*", cors());
	app.use("/mcp", cors());
	app.use("/pdf", cors());

	app.get("/", (c) =>
		c.json({
			service: "better-agent-finance-mcp",
			status: "ok",
			tools: TOOLS.length,
			endpoints: { mcp: "POST /mcp", rest: "GET /api/*", pdf: "GET /pdf" },
		})
	);

	app.post("/mcp", async (c) => {
		let message: Parameters<typeof handleMessage>[0];
		try {
			message = await c.req.json();
		} catch {
			return c.json(
				{
					jsonrpc: "2.0",
					id: null,
					error: { code: PARSE_ERROR, message: "Parse error" },
				},
				BAD_REQUEST
			);
		}
		const response = await handleMessage(message, c.env as ToolEnv);
		if (response === null) {
			return c.body(null, ACCEPTED);
		}
		return c.json(response);
	});

	registerRest(app);

	app.get("/api/_debug/clist", debugClist);

	app.get("/pdf", createPdfProxyHandler(fetch));

	app.onError((err, c) => {
		if (err instanceof NotConfiguredError) {
			return c.json({ error: err.message }, NOT_CONFIGURED);
		}
		if (err instanceof BadSymbolError) {
			return c.json({ error: err.message }, BAD_REQUEST);
		}
		if (err instanceof Error) {
			return c.json({ error: err.message }, BAD_GATEWAY);
		}
		throw err;
	});

	return app;
}
