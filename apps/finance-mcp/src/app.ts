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
