import type { AgentRow } from "@/utils/api-types";

// S3-T3: the /local list is retired, so the old cloud+local "unified" row
// union collapsed to cloud agents only. File name kept to avoid churning the
// (unchanged) sibling imports.

/** One row of the /agents list — a cloud agent config. */
export interface AgentListRow {
	agent: AgentRow;
}

export function rowSubtitle(row: AgentListRow): string {
	return `${row.agent.providerId}/${row.agent.modelId}`;
}

export function rowCreatedAt(row: AgentListRow): Date {
	return new Date(row.agent.createdAt);
}

/** Filter for useListView — `query` arrives already trimmed + lowercased
 * (use-list-view.ts does this before calling). */
export function matchAgentRow(row: AgentListRow, query: string): boolean {
	return (
		row.agent.name.toLowerCase().includes(query) ||
		rowSubtitle(row).toLowerCase().includes(query)
	);
}

/** Wraps the fetched agents as list rows, newest first. */
export function sortAgentRows(agents: AgentRow[]): AgentListRow[] {
	return agents
		.map((agent): AgentListRow => ({ agent }))
		.sort((a, b) => rowCreatedAt(b).getTime() - rowCreatedAt(a).getTime());
}
