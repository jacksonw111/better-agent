import { useQuery } from "@tanstack/react-query";
import type { CloudAgentUsageRow } from "@/utils/api-types";
import { orpc } from "@/utils/orpc";
import { CENTS_PER_DOLLAR, type WindowDays } from "./dashboard-constants";

/**
 * Cloud (hosted web) agent usage broken down by agent, for the given window.
 * Cloud counterpart of `useLocalAgentUsage`: unlike local agent kinds (a
 * fixed enum, always zero-filled), cloud agents are a dynamic per-user set,
 * so rows aren't zero-filled — `isEmpty` is true only when the user has no
 * cloud-agent usage in the window at all.
 */
export function useCloudAgentUsage(windowDays: WindowDays) {
	const query = useQuery(
		orpc.usage.byAgent.queryOptions({ input: { windowDays } })
	);
	const byAgent = query.data?.byAgent ?? [];
	const rows: CloudAgentUsageRow[] = byAgent.map((row) => ({
		agentId: row.agentId,
		name: row.name,
		inputTokens: row.inputTokens,
		outputTokens: row.outputTokens,
		turns: row.turns,
		costUsd: row.costCents / CENTS_PER_DOLLAR,
	}));
	return {
		isPending: query.isPending,
		isEmpty: !(query.isPending || query.isError) && rows.length === 0,
		rows,
	};
}
