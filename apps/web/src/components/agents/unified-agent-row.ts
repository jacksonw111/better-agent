import { localAgentDisplayName } from "@/components/bridge/local-agent-format";
import type { LocalAgentEntry } from "@/components/bridge/local-agent-join";
import { AGENT_KIND_LABEL } from "@/components/bridge/local-agent-kind-icon";
import type { AgentRow } from "@/utils/api-types";

/** One row of the merged Agents list — a cloud agent config or a local
 * bridge token, discriminated by `type` so cells/actions can branch. */
export type UnifiedAgentRow =
	| { type: "cloud"; agent: AgentRow }
	| { type: "local"; entry: LocalAgentEntry; sessionCount: number };

export const TYPE_LABEL: Record<UnifiedAgentRow["type"], string> = {
	cloud: "Cloud Agent",
	local: "Local Agent",
};

export function rowId(row: UnifiedAgentRow): string {
	return row.type === "cloud" ? row.agent.id : row.entry.token.id;
}

export function rowName(row: UnifiedAgentRow): string {
	return row.type === "cloud"
		? row.agent.name
		: localAgentDisplayName(row.entry);
}

export function rowSubtitle(row: UnifiedAgentRow): string {
	return row.type === "cloud"
		? `${row.agent.providerId}/${row.agent.modelId}`
		: AGENT_KIND_LABEL[row.entry.token.agentKind];
}

export function rowCreatedAt(row: UnifiedAgentRow): Date {
	return new Date(
		row.type === "cloud" ? row.agent.createdAt : row.entry.token.createdAt
	);
}

export function matchUnifiedRow(row: UnifiedAgentRow, query: string): boolean {
	return (
		rowName(row).toLowerCase().includes(query) ||
		rowSubtitle(row).toLowerCase().includes(query) ||
		TYPE_LABEL[row.type].toLowerCase().includes(query)
	);
}

/** Merges both agent sources into one list, newest first. */
export function mergeUnifiedRows(
	agents: AgentRow[],
	entries: LocalAgentEntry[],
	sessionCounts: Map<string, number>
): UnifiedAgentRow[] {
	const rows: UnifiedAgentRow[] = [
		...agents.map((agent): UnifiedAgentRow => ({ agent, type: "cloud" })),
		...entries.map(
			(entry): UnifiedAgentRow => ({
				entry,
				sessionCount: sessionCounts.get(entry.token.id) ?? 0,
				type: "local",
			})
		),
	];
	return rows.sort(
		(a, b) => rowCreatedAt(b).getTime() - rowCreatedAt(a).getTime()
	);
}
