import { Hono } from "hono";
import { cors } from "hono/cors";
import { requireToken } from "./auth";
import { NotConfiguredError } from "./core/weread-client";
import { handleMessage } from "./mcp-server";
import { registerRest } from "./rest";
import { TOOLS } from "./tool-defs";
import type { ToolEnv } from "./tools-impl";

const ACCEPTED = 202;
const BAD_REQUEST = 400;
const NOT_CONFIGURED = 503;
const BAD_GATEWAY = 502;
const PARSE_ERROR = -32_700;

function resolveWereadEnv(
	env: ToolEnv | undefined,
	headerValue: string | undefined
): ToolEnv {
	const fallback = env?.WEREAD_API_KEY;
	const key =
		(headerValue && headerValue.length > 0 ? headerValue : fallback) ?? "";
	return { ...(env ?? {}), WEREAD_API_KEY: key };
}

function registerGuards(app: Hono): void {
	app.use("/api/*", cors());
	app.use("/mcp", cors());
	app.use("/mcp", requireToken);
	app.use("/api/*", requireToken);
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
	registerGuards(app);

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
			c.req.header("x-weread-key")
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
