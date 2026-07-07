import { useQueries, useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

import type { McpServerRow } from "@/utils/api-types";
import { orpc } from "@/utils/orpc";

export interface ToolRow {
	description: string;
	name: string;
}

export interface ToolGroup {
	key: string;
	label: string;
	tools: ToolRow[];
}

export function allToolNames(groups: ToolGroup[]): string[] {
	return groups.flatMap((group) => group.tools.map((tool) => tool.name));
}

// Purpose group for a composio tool name: the prefix before the first
// underscore (GMAIL_SEND_EMAIL -> GMAIL).
function prefixOf(name: string): string {
	const cut = name.indexOf("_");
	return cut === -1 ? name : name.slice(0, cut);
}

function buildComposioGroups(
	results: { data?: { tools: ToolRow[] } }[]
): ToolGroup[] {
	const byPrefix = new Map<string, ToolRow[]>();
	for (const result of results) {
		for (const tool of result.data?.tools ?? []) {
			const prefix = prefixOf(tool.name);
			const list = byPrefix.get(prefix) ?? [];
			list.push(tool);
			byPrefix.set(prefix, list);
		}
	}
	return [...byPrefix.entries()]
		.map(([label, tools]) => ({
			key: `composio:${label}`,
			label,
			tools: [...tools].sort((a, b) => a.name.localeCompare(b.name)),
		}))
		.sort((a, b) => a.label.localeCompare(b.label));
}

function buildMcpGroups(
	serverIds: string[],
	servers: McpServerRow[] | undefined,
	results: { data?: ToolRow[] }[]
): ToolGroup[] {
	return serverIds.map((serverId, index) => {
		const label =
			servers?.find((row) => row.id === serverId)?.name ?? "MCP server";
		const tools = [...(results[index].data ?? [])].sort((a, b) =>
			a.name.localeCompare(b.name)
		);
		return { key: `mcp:${serverId}`, label, tools };
	});
}

// Cheap group labels: reuse the account/server list queries the Composio and
// MCP fields above already populate, so this is a cache hit, not a new call.
// Tool catalogs change rarely; cache them hard so reopening the menu is
// instant (queries fire when the chat mounts, so the first open is warm too).
const TOOLS_STALE_MS = 300_000;
const TOOLS_GC_MS = 900_000;

// An agent may reference sources that were deleted since (stale ids). Only
// query catalogs for sources that still EXIST — a missing source is a normal
// "0 tools" state, not a request worth making or an error worth toasting.
function useLiveSourceIds(accountIds: string[], serverIds: string[]) {
	const accounts = useQuery({
		...orpc.composio.listAccounts.queryOptions(),
		staleTime: TOOLS_STALE_MS,
		meta: { silent: true },
	});
	const mcpServers = useQuery({
		...orpc.mcp.listServers.queryOptions(),
		staleTime: TOOLS_STALE_MS,
		meta: { silent: true },
	});
	return {
		liveAccountIds: accountIds.filter((id) =>
			(accounts.data ?? []).some((row) => row.id === id)
		),
		liveServerIds: serverIds.filter((id) =>
			(mcpServers.data ?? []).some((row) => row.id === id)
		),
		listsPending:
			(accountIds.length > 0 && accounts.isPending) ||
			(serverIds.length > 0 && mcpServers.isPending),
		mcpServers,
	};
}

export function useToolSources(accountIds: string[], serverIds: string[]) {
	const { liveAccountIds, liveServerIds, listsPending, mcpServers } =
		useLiveSourceIds(accountIds, serverIds);
	const composioResults = useQueries({
		queries: liveAccountIds.map((accountId) => ({
			...orpc.composio.tools.queryOptions({ input: { accountId } }),
			staleTime: TOOLS_STALE_MS,
			gcTime: TOOLS_GC_MS,
			retry: false,
			meta: { silent: true },
		})),
	});
	const mcpResults = useQueries({
		queries: liveServerIds.map((serverId) => ({
			...orpc.mcp.tools.queryOptions({ input: { serverId } }),
			staleTime: TOOLS_STALE_MS,
			gcTime: TOOLS_GC_MS,
			retry: false,
			meta: { silent: true },
		})),
	});
	const isPending =
		listsPending ||
		composioResults.some((r) => r.isPending) ||
		mcpResults.some((r) => r.isPending);
	const errors = [...composioResults, ...mcpResults]
		.map((r) => r.error)
		.filter((error): error is Error => error !== null);
	const groups = useMemo(() => {
		if (isPending) {
			return [];
		}
		return [
			...buildComposioGroups(composioResults),
			...buildMcpGroups(liveServerIds, mcpServers.data, mcpResults),
		].filter((group) => group.tools.length > 0);
	}, [isPending, composioResults, mcpResults, mcpServers.data, liveServerIds]);
	return { groups, isPending, errors };
}
