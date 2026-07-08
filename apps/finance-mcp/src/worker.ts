import { initLogger } from "evlog";
import { buildApp } from "./app";

initLogger({ env: { service: "better-agent-finance-mcp" } });

export default buildApp();
