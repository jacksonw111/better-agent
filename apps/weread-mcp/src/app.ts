import { Hono } from "hono";
import { cors } from "hono/cors";
import { NotConfiguredError } from "./core/weread-client";
import { handleMessage } from "./mcp-server";
import { registerRest } from "./rest";
import { TOOLS } from "./tool-defs";
import type { ToolEnv } from "./tools-impl";

// Streamable HTTP endpoint in stateless JSON mode: every POST carries one
// JSON-RPC message. The caller's WeRead API key (wrk-xxxxxxxx) rides on each
// request as the bearer token — the platform's MCP client stores it as the
// server's authHeader and sends `Authorization: Bearer wrk-…` on every call.

const ACCEPTED = 202;
const BAD_REQUEST = 400;
const NOT_CONFIGURED = 503;
const BAD_GATEWAY = 502;
const PARSE_ERROR = -32_700;
const BEARER_RE = /^Bearer\s+(.+)$/i;

function bearerToken(header: string | undefined): string {
	if (!header) {
		return "";
	}
	const match = header.match(BEARER_RE);
	return match?.[1]?.trim() ?? "";
}

function resolveWereadEnv(
	env: ToolEnv | undefined,
	authorization: string | undefined
): ToolEnv {
	const key = bearerToken(authorization) || env?.WEREAD_API_KEY || "";
	return { ...(env ?? {}), WEREAD_API_KEY: key };
}

function registerErrorHandler(app: Hono): void {
	app.onError((err, c) => {
		if (err instanceof NotConfiguredError) {
			return c.json({ error: err.message }, NOT_CONFIGURED);
		}
		if (err instanceof Error) {
			return c.json({ error: err.message }, BAD_GATEWAY);
		}
		throw err;
	});
}

export function buildApp(): Hono {
	const app = new Hono();
	app.use("/api/*", cors());
	app.use("/mcp", cors());

	app.get("/", (c) =>
		c.json({
			service: "better-agent-weread-mcp",
			status: "ok",
			tools: TOOLS.length,
			endpoints: { mcp: "POST /mcp", rest: "GET /api/*" },
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
		const env = resolveWereadEnv(
			c.env as ToolEnv,
			c.req.header("authorization")
		);
		const response = await handleMessage(message, env);
		if (response === null) {
			return c.body(null, ACCEPTED);
		}
		return c.json(response);
	});

	registerRest(app);
	registerErrorHandler(app);

	return app;
}
