import { Hono } from "hono";

export function buildApp(): Hono {
	const app = new Hono();
	app.get("/", (c) => c.text("better-agent-finance-mcp OK"));
	return app;
}
