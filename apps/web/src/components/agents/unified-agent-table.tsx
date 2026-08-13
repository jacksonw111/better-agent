import {
	Avatar,
	AvatarFallback,
	AvatarImage,
} from "@better-agent/ui/components/avatar";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@better-agent/ui/components/table";
import { useNavigate } from "@tanstack/react-router";
import { EmptyState } from "@/components/layout/empty-state";
import type { AgentRow } from "@/utils/api-types";
import { agentAvatar } from "@/utils/avatar";
import { AgentRowActions } from "./agent-row-actions";
import { CloudAgentTokenCell } from "./cloud-agent-token-cell";
import {
	type AgentListRow,
	rowCreatedAt,
	rowSubtitle,
} from "./unified-agent-row";

// The /agents table: one row per cloud agent.

const AVATAR_INITIALS_LENGTH = 2;
const COLUMN_COUNT = 4;

const createdFormatter = new Intl.DateTimeFormat(undefined, {
	dateStyle: "medium",
});

/** The action callbacks each row cell needs — grouped so the row components
 * stay under the param cap and the two views share one shape. */
export interface AgentRowCallbacks {
	onDelete: (id: string) => void;
	onEdit: (row: AgentRow) => void;
	onTokenRotated: (token: string) => void;
}

/** The empty-state copy the page passes in. */
export interface AgentListEmptyCopy {
	body: string;
	title: string;
}

/** The cloud agent's identity block — avatar + a name button that navigates to
 * the chat, with the provider/model as the mono sub-line. */
function AgentIdentity({ row }: { row: AgentListRow }) {
	const { agent } = row;
	const navigate = useNavigate();
	return (
		<div className="flex min-w-0 items-center gap-2">
			<Avatar size="sm">
				<AvatarImage alt={agent.name} src={agentAvatar(agent.id)} />
				<AvatarFallback>
					{agent.name.slice(0, AVATAR_INITIALS_LENGTH).toUpperCase()}
				</AvatarFallback>
			</Avatar>
			<div className="flex min-w-0 flex-col">
				<button
					className="truncate text-left font-medium hover:underline"
					onClick={() =>
						navigate({ search: { agentId: agent.id }, to: "/chat" })
					}
					type="button"
				>
					{agent.name}
				</button>
				<span className="truncate font-mono text-muted-foreground text-xs">
					{rowSubtitle(row)}
				</span>
			</div>
		</div>
	);
}

function DesktopRow({
	row,
	callbacks,
}: {
	row: AgentListRow;
	callbacks: AgentRowCallbacks;
}) {
	return (
		<TableRow>
			<TableCell>
				<AgentIdentity row={row} />
			</TableCell>
			<TableCell className="text-muted-foreground tabular-nums">
				{createdFormatter.format(rowCreatedAt(row))}
			</TableCell>
			<TableCell>
				<CloudAgentTokenCell agentId={row.agent.id} />
			</TableCell>
			<TableCell className="text-right">
				<AgentRowActions
					onDelete={callbacks.onDelete}
					onEdit={callbacks.onEdit}
					onTokenRotated={callbacks.onTokenRotated}
					row={row.agent}
				/>
			</TableCell>
		</TableRow>
	);
}

/** Desktop view: one row per agent across the fixed columns
 * Agent · Created · Token · Actions. */
export function AgentTable({
	rows,
	callbacks,
	empty,
}: {
	rows: AgentListRow[];
	callbacks: AgentRowCallbacks;
	empty: AgentListEmptyCopy;
}) {
	return (
		<Table>
			<TableHeader>
				<TableRow>
					<TableHead>Agent</TableHead>
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
							{`${empty.title} — ${empty.body}`}
						</TableCell>
					</TableRow>
				) : (
					rows.map((row) => (
						<DesktopRow callbacks={callbacks} key={row.agent.id} row={row} />
					))
				)}
			</TableBody>
		</Table>
	);
}

function MobileItem({
	row,
	callbacks,
}: {
	row: AgentListRow;
	callbacks: AgentRowCallbacks;
}) {
	return (
		<div className="flex flex-col gap-2 p-3">
			<AgentIdentity row={row} />
			<div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-muted-foreground text-xs">
				<span>{createdFormatter.format(rowCreatedAt(row))}</span>
			</div>
			<div className="flex items-center justify-between">
				<CloudAgentTokenCell agentId={row.agent.id} />
				<AgentRowActions
					onDelete={callbacks.onDelete}
					onEdit={callbacks.onEdit}
					onTokenRotated={callbacks.onTokenRotated}
					row={row.agent}
				/>
			</div>
		</div>
	);
}

/** Mobile view: a flat bordered, divided list (NOT shadcn Card) mirroring the
 * table's cells. */
export function AgentMobileList({
	rows,
	callbacks,
	empty,
}: {
	rows: AgentListRow[];
	callbacks: AgentRowCallbacks;
	empty: AgentListEmptyCopy;
}) {
	if (rows.length === 0) {
		return <EmptyState body={empty.body} title={empty.title} />;
	}
	return (
		<div className="flex flex-col divide-y rounded-md border">
			{rows.map((row) => (
				<MobileItem callbacks={callbacks} key={row.agent.id} row={row} />
			))}
		</div>
	);
}
