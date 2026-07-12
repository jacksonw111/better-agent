import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@better-agent/ui/components/table";
import { DeleteConfirm } from "@/components/list/delete-confirm";
import { localAgentDisplayName } from "./local-agent-format";
import { LocalAgentIdentity } from "./local-agent-identity";
import type { LocalAgentEntry } from "./local-agent-join";
import { LocalAgentStatusChip } from "./local-agent-status-chip";
import { LocalAgentTokenCell } from "./local-agent-token-cell";

const COLUMN_COUNT = 6;

const createdFormatter = new Intl.DateTimeFormat(undefined, {
	dateStyle: "medium",
});

export interface LocalAgentTableRow {
	entry: LocalAgentEntry;
	sessionCount: number;
}

function RowActions({
	entry,
	onDelete,
}: {
	entry: LocalAgentEntry;
	onDelete: (tokenId: string) => void;
}) {
	return (
		<DeleteConfirm
			label={`Delete ${localAgentDisplayName(entry)}? Its token and all sessions are removed.`}
			onConfirm={() => onDelete(entry.token.id)}
		/>
	);
}

function AgentRow({
	row,
	onDelete,
}: {
	row: LocalAgentTableRow;
	onDelete: (tokenId: string) => void;
}) {
	const { entry, sessionCount } = row;
	return (
		<TableRow>
			<TableCell>
				<LocalAgentIdentity entry={entry} />
			</TableCell>
			<TableCell>
				<LocalAgentStatusChip status={entry.status} />
			</TableCell>
			<TableCell className="text-muted-foreground tabular-nums">
				{sessionCount}
			</TableCell>
			<TableCell className="text-muted-foreground tabular-nums">
				{createdFormatter.format(new Date(entry.token.createdAt))}
			</TableCell>
			<TableCell>
				<LocalAgentTokenCell token={entry.token} />
			</TableCell>
			<TableCell className="text-right">
				<RowActions entry={entry} onDelete={onDelete} />
			</TableCell>
		</TableRow>
	);
}

/** The Local Agents list as a table: one row per bridge token with its agent
 * kind, live status, session count and created date. Rows link to the agent's
 * detail page; the Actions cell deletes the token (after confirm) without
 * triggering that navigation. */
export function LocalAgentTable({
	rows,
	onDelete,
}: {
	rows: LocalAgentTableRow[];
	onDelete: (tokenId: string) => void;
}) {
	return (
		<Table>
			<TableHeader>
				<TableRow>
					<TableHead>Agent</TableHead>
					<TableHead>Status</TableHead>
					<TableHead>Sessions</TableHead>
					<TableHead>Created</TableHead>
					<TableHead>Token</TableHead>
					<TableHead className="text-right">Actions</TableHead>
				</TableRow>
			</TableHeader>
			<TableBody>
				{rows.length === 0 ? (
					<TableRow>
						<TableCell
							className="h-24 text-center text-muted-foreground"
							colSpan={COLUMN_COUNT}
						>
							No local agents yet — add one to start streaming a session here.
						</TableCell>
					</TableRow>
				) : (
					rows.map((row) => (
						<AgentRow key={row.entry.token.id} onDelete={onDelete} row={row} />
					))
				)}
			</TableBody>
		</Table>
	);
}
