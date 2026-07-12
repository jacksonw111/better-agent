import {
	Avatar,
	AvatarFallback,
	AvatarImage,
} from "@better-agent/ui/components/avatar";
import {
	Card,
	CardContent,
	CardFooter,
} from "@better-agent/ui/components/card";
import { EmptyState } from "@/components/layout/empty-state";
import type { AgentRow } from "@/utils/api-types";
import { agentAvatar } from "@/utils/avatar";
import { AgentRowActions } from "./agent-row-actions";
import { AgentTokenCell } from "./agent-token-cell";

const AVATAR_INITIALS_LENGTH = 2;

function AgentCard({
	row,
	onEdit,
	onDelete,
	onTokenRotated,
}: {
	row: AgentRow;
	onEdit: (row: AgentRow) => void;
	onDelete: (id: string) => void;
	onTokenRotated: (token: string) => void;
}) {
	return (
		<Card>
			<CardContent className="flex items-center gap-3">
				<Avatar size="sm">
					<AvatarImage alt={row.name} src={agentAvatar(row.id)} />
					<AvatarFallback>
						{row.name.slice(0, AVATAR_INITIALS_LENGTH).toUpperCase()}
					</AvatarFallback>
				</Avatar>
				<div className="flex min-w-0 flex-col">
					<span className="truncate font-medium">{row.name}</span>
					<span className="truncate font-mono text-muted-foreground text-xs">
						{row.providerId}/{row.modelId}
					</span>
				</div>
			</CardContent>
			<CardFooter className="items-center justify-between">
				<AgentTokenCell agentId={row.id} />
				<AgentRowActions
					onDelete={onDelete}
					onEdit={onEdit}
					onTokenRotated={onTokenRotated}
					row={row}
				/>
			</CardFooter>
		</Card>
	);
}

/** The Agents list as a card-per-row list — the <md counterpart of
 * AgentsTable in agents-card.tsx, sharing the exact same `rows`/callbacks so
 * the two views can't drift. Actions sit at the card bottom (thumb-friendly),
 * mirroring AgentRowActions' chat/edit/rotate/delete cluster as-is. */
export function AgentsCardList({
	rows,
	onEdit,
	onDelete,
	onTokenRotated,
}: {
	rows: AgentRow[];
	onEdit: (row: AgentRow) => void;
	onDelete: (id: string) => void;
	onTokenRotated: (token: string) => void;
}) {
	if (rows.length === 0) {
		return (
			<EmptyState
				body="Add one to give it a model, a token, and a chat."
				title="No agents yet"
			/>
		);
	}
	return (
		<div className="flex flex-col gap-3">
			{rows.map((row) => (
				<AgentCard
					key={row.id}
					onDelete={onDelete}
					onEdit={onEdit}
					onTokenRotated={onTokenRotated}
					row={row}
				/>
			))}
		</div>
	);
}
