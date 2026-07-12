import {
	Avatar,
	AvatarFallback,
	AvatarImage,
} from "@better-agent/ui/components/avatar";
import { Badge } from "@better-agent/ui/components/badge";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@better-agent/ui/components/table";
import { useNavigate } from "@tanstack/react-router";
import { localAgentDisplayName } from "@/components/bridge/local-agent-format";
import { LocalAgentIdentity } from "@/components/bridge/local-agent-identity";
import { LocalAgentStatusChip } from "@/components/bridge/local-agent-status-chip";
import { LocalAgentTokenCell } from "@/components/bridge/local-agent-token-cell";
import { EmptyState } from "@/components/layout/empty-state";
import { DeleteConfirm } from "@/components/list/delete-confirm";
import type { AgentRow } from "@/utils/api-types";
import { agentAvatar } from "@/utils/avatar";
import { AgentRowActions } from "./agent-row-actions";
import { CloudAgentTokenCell } from "./cloud-agent-token-cell";
import {
	rowCreatedAt,
	rowId,
	rowSubtitle,
	TYPE_LABEL,
	type UnifiedAgentRow,
} from "./unified-agent-row";

const AVATAR_INITIALS_LENGTH = 2;
const COLUMN_COUNT = 6;

const createdFormatter = new Intl.DateTimeFormat(undefined, {
	dateStyle: "medium",
});

/** The cloud/local action callbacks each row cell needs — grouped so the row
 * components stay under the param cap and the two views share one shape. */
export interface UnifiedRowCallbacks {
	onCloudDelete: (id: string) => void;
	onCloudEdit: (row: AgentRow) => void;
	onCloudTokenRotated: (token: string) => void;
	onLocalDelete: (tokenId: string) => void;
}

type CloudRow = Extract<UnifiedAgentRow, { type: "cloud" }>;

function TypeBadge({ type }: { type: UnifiedAgentRow["type"] }) {
	return (
		<Badge className="font-normal text-muted-foreground" variant="outline">
			{TYPE_LABEL[type]}
		</Badge>
	);
}

/** The cloud agent's identity block — avatar + a name button that navigates to
 * the chat, with the provider/model as the mono sub-line (the old Model column,
 * folded in to match `LocalAgentIdentity`'s layout). */
function CloudAgentIdentity({ row }: { row: CloudRow }) {
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

function AgentIdentity({ row }: { row: UnifiedAgentRow }) {
	return row.type === "local" ? (
		<LocalAgentIdentity entry={row.entry} />
	) : (
		<CloudAgentIdentity row={row} />
	);
}

function StatusCell({ row }: { row: UnifiedAgentRow }) {
	return row.type === "local" ? (
		<LocalAgentStatusChip status={row.entry.status} />
	) : (
		<span className="text-muted-foreground text-xs">—</span>
	);
}

function TokenCell({ row }: { row: UnifiedAgentRow }) {
	return row.type === "local" ? (
		<LocalAgentTokenCell token={row.entry.token} />
	) : (
		<CloudAgentTokenCell agentId={row.agent.id} />
	);
}

function ActionsCell({
	row,
	callbacks,
}: {
	row: UnifiedAgentRow;
	callbacks: UnifiedRowCallbacks;
}) {
	if (row.type === "local") {
		return (
			<DeleteConfirm
				label={`Delete ${localAgentDisplayName(row.entry)}? Its token and all sessions are removed.`}
				onConfirm={() => callbacks.onLocalDelete(row.entry.token.id)}
			/>
		);
	}
	return (
		<AgentRowActions
			onDelete={callbacks.onCloudDelete}
			onEdit={callbacks.onCloudEdit}
			onTokenRotated={callbacks.onCloudTokenRotated}
			row={row.agent}
		/>
	);
}

function DesktopRow({
	row,
	callbacks,
}: {
	row: UnifiedAgentRow;
	callbacks: UnifiedRowCallbacks;
}) {
	return (
		<TableRow>
			<TableCell>
				<AgentIdentity row={row} />
			</TableCell>
			<TableCell>
				<TypeBadge type={row.type} />
			</TableCell>
			<TableCell>
				<StatusCell row={row} />
			</TableCell>
			<TableCell className="text-muted-foreground tabular-nums">
				{createdFormatter.format(rowCreatedAt(row))}
			</TableCell>
			<TableCell>
				<TokenCell row={row} />
			</TableCell>
			<TableCell className="text-right">
				<ActionsCell callbacks={callbacks} row={row} />
			</TableCell>
		</TableRow>
	);
}

const EMPTY_COPY =
	"No agents yet — add a cloud agent or connect a local one to get started.";

/** Desktop view: one row per unified agent across the fixed columns
 * Agent · Type · Status · Created · Token · Actions. */
export function UnifiedAgentTable({
	rows,
	callbacks,
}: {
	rows: UnifiedAgentRow[];
	callbacks: UnifiedRowCallbacks;
}) {
	return (
		<Table>
			<TableHeader>
				<TableRow>
					<TableHead>Agent</TableHead>
					<TableHead>Type</TableHead>
					<TableHead>Status</TableHead>
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
							{EMPTY_COPY}
						</TableCell>
					</TableRow>
				) : (
					rows.map((row) => (
						<DesktopRow callbacks={callbacks} key={rowId(row)} row={row} />
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
	row: UnifiedAgentRow;
	callbacks: UnifiedRowCallbacks;
}) {
	return (
		<div className="flex flex-col gap-2 p-3">
			<AgentIdentity row={row} />
			<div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-muted-foreground text-xs">
				<TypeBadge type={row.type} />
				{row.type === "local" ? (
					<LocalAgentStatusChip status={row.entry.status} />
				) : null}
				<span>{createdFormatter.format(rowCreatedAt(row))}</span>
			</div>
			<div className="flex items-center justify-between">
				<TokenCell row={row} />
				<ActionsCell callbacks={callbacks} row={row} />
			</div>
		</div>
	);
}

/** Mobile view: a flat bordered, divided list (NOT shadcn Card) mirroring the
 * table's cell branching. */
export function UnifiedAgentMobileList({
	rows,
	callbacks,
}: {
	rows: UnifiedAgentRow[];
	callbacks: UnifiedRowCallbacks;
}) {
	if (rows.length === 0) {
		return (
			<EmptyState
				body="Add a cloud agent or connect a local one to get started."
				title="No agents yet"
			/>
		);
	}
	return (
		<div className="flex flex-col divide-y rounded-md border">
			{rows.map((row) => (
				<MobileItem callbacks={callbacks} key={rowId(row)} row={row} />
			))}
		</div>
	);
}
