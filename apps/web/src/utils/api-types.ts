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

export type OpenConnectorAccountRow = Awaited<
	ReturnType<Client["openConnector"]["listAccounts"]>
>[number];

export type OpenConnectorProviderRow = Awaited<
	ReturnType<Client["openConnector"]["providers"]>
>[number];

export type McpServerRow = Awaited<
	ReturnType<Client["mcp"]["listServers"]>
>[number];

export type BridgeTokenRow = Awaited<
	ReturnType<Client["bridge"]["listTokens"]>
>[number];

export type ComputerListItem = Awaited<
	ReturnType<Client["computers"]["list"]>
>[number];

export type BridgeSessionRow = Awaited<
	ReturnType<Client["bridge"]["listSessions"]>
>["sessions"][number];

export type LocalAgentUsageRow = Awaited<
	ReturnType<Client["bridge"]["usageByAgentKind"]>
>["byKind"][number];

export type CloudAgentUsageServerRow = Awaited<
	ReturnType<Client["usage"]["byAgent"]>
>["byAgent"][number];

/** Display row for the Cloud Agents card: same shape the server returns, but
 * with `costCents` converted to `costUsd` (dollars) so the view can reuse
 * `formatCostUsd` — the same formatter the Local Agents card uses. */
export type CloudAgentUsageRow = Omit<CloudAgentUsageServerRow, "costCents"> & {
	costUsd: number;
};
