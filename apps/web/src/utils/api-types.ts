import type { AppRouter } from "@better-agent/api/routers/index";
import type { RouterClient } from "@orpc/server";

type Client = RouterClient<AppRouter>;

export type AgentRow = Awaited<ReturnType<Client["agents"]["list"]>>[number];

export type UserSessionRow = Awaited<
	ReturnType<Client["userSessions"]["list"]>
>[number];

export type ComposioAccountRow = Awaited<
	ReturnType<Client["composio"]["listAccounts"]>
>[number];

export type ComposioToolkitRow = Awaited<
	ReturnType<Client["composio"]["toolkits"]>
>[number];

export type McpServerRow = Awaited<
	ReturnType<Client["mcp"]["listServers"]>
>[number];

export type BridgeTokenRow = Awaited<
	ReturnType<Client["bridge"]["listTokens"]>
>[number];

export type BridgeSessionRow = Awaited<
	ReturnType<Client["bridge"]["listSessions"]>
>[number];

export type LocalAgentUsageRow = Awaited<
	ReturnType<Client["bridge"]["usageByAgentKind"]>
>["byKind"][number];
