import { Hono } from "hono";
import { handleMessage } from "./mcp-server";
import { createPdfProxyHandler } from "./pdf-proxy";
import { registerRest } from "./rest";

// Streamable HTTP endpoint in stateless JSON mode: every POST carries one
// JSON-RPC message; responses come back as application/json (the spec allows
// a plain JSON body instead of an SSE stream). No session state is kept.

const ACCEPTED = 202;
const BAD_REQUEST = 400;
const PARSE_ERROR = -32_700;

export function buildApp(): Hono {
	const app = new Hono();
	app.get("/", (c) => c.text("better-agent-finance-mcp OK"));

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
		const response = await handleMessage(message);
		if (response === null) {
			return c.body(null, ACCEPTED);
		}
		return c.json(response);
	});

	registerRest(app);

	app.get("/pdf", createPdfProxyHandler(fetch));

	return app;
}
