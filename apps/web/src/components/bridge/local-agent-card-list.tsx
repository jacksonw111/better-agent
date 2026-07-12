import {
	Card,
	CardContent,
	CardFooter,
} from "@better-agent/ui/components/card";
import { EmptyState } from "@/components/layout/empty-state";
import { DeleteConfirm } from "@/components/list/delete-confirm";
import { localAgentDisplayName } from "./local-agent-format";
import { LocalAgentIdentity } from "./local-agent-identity";
import { LocalAgentStatusChip } from "./local-agent-status-chip";
import type { LocalAgentTableRow } from "./local-agent-table";
import { LocalAgentTokenCell } from "./local-agent-token-cell";

const createdFormatter = new Intl.DateTimeFormat(undefined, {
	dateStyle: "medium",
});

function AgentCardMeta({ row }: { row: LocalAgentTableRow }) {
	const { entry, sessionCount } = row;
	return (
		<div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-muted-foreground text-xs">
			<LocalAgentStatusChip status={entry.status} />
			<span>
				{sessionCount} session{sessionCount === 1 ? "" : "s"}
			</span>
			<span>{createdFormatter.format(new Date(entry.token.createdAt))}</span>
		</div>
	);
}

function AgentCard({
	row,
	onDelete,
}: {
	row: LocalAgentTableRow;
	onDelete: (tokenId: string) => void;
}) {
	const { entry } = row;
	return (
		<Card>
			<CardContent className="flex flex-col gap-2">
				<LocalAgentIdentity entry={entry} />
				<AgentCardMeta row={row} />
			</CardContent>
			<CardFooter className="items-center justify-between">
				<LocalAgentTokenCell token={entry.token} />
				<DeleteConfirm
					label={`Delete ${localAgentDisplayName(entry)}? Its token and all sessions are removed.`}
					onConfirm={() => onDelete(entry.token.id)}
				/>
			</CardFooter>
		</Card>
	);
}

/** The Local Agents list as a card-per-row list — the <md counterpart of
 * LocalAgentTable, sharing the exact same `rows`/`onDelete` so the two views
 * can't drift. Actions sit at the card bottom (thumb-friendly), the name
 * stays the sole navigation target (same convention as the table). */
export function LocalAgentCardList({
	rows,
	onDelete,
}: {
	rows: LocalAgentTableRow[];
	onDelete: (tokenId: string) => void;
}) {
	if (rows.length === 0) {
		return (
			<EmptyState
				body="Add one to start streaming a session here."
				title="No local agents yet"
			/>
		);
	}
	return (
		<div className="flex flex-col gap-3">
			{rows.map((row) => (
				<AgentCard key={row.entry.token.id} onDelete={onDelete} row={row} />
			))}
		</div>
	);
}
