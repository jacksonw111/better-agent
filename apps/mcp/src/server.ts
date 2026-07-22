import { serve } from "@hono/node-server";
import { initLogger, log } from "evlog";
import { buildApp } from "./app";

// Node entry (docker compose). Runs alongside the Workers entry (worker.ts) —
// same Hono app, served over plain HTTP here. Hono reads request-scoped env
// from the 2nd arg to `app.fetch`, which Workers fills from bindings; under
// Node we inject `process.env` so `c.env.*` resolves to the container's env.

initLogger({ env: { service: "better-agent-mcp" } });

const DEFAULT_PORT = 3004;
const port = Number(process.env.PORT ?? DEFAULT_PORT);
const app = buildApp();

serve(
	{
		fetch: (req: Request) =>
			app.fetch(req, process.env as Record<string, string>),
		port,
	},
	(info) => {
		log.info(
			"mcp",
			`better-agent-mcp listening on http://0.0.0.0:${info.port}`
		);
	}
);
