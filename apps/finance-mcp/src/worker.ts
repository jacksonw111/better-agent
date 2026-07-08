import { initLogger } from "evlog";
import { buildApp } from "./app";

initLogger({ env: { service: "better-agent-finance-mcp" } });

const app = buildApp();

export default {
	fetch: (req: Request, env: Record<string, string>, ctx: ExecutionContext) =>
		app.fetch(req, env, ctx),
};
