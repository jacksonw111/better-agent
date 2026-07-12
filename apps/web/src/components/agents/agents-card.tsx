import {
	Avatar,
	AvatarFallback,
	AvatarImage,
} from "@better-agent/ui/components/avatar";
import { Button } from "@better-agent/ui/components/button";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@better-agent/ui/components/table";
import { useQuery } from "@tanstack/react-query";
import { PlusIcon } from "lucide-react";
import { ListToolbar } from "@/components/list/list-toolbar";
import { MOBILE_FAB_CLASS } from "@/components/list/mobile-fab-class";
import { Pagination } from "@/components/list/pagination";
import { type ListView, useListView } from "@/components/list/use-list-view";
import type { AgentRow } from "@/utils/api-types";
import { agentAvatar } from "@/utils/avatar";
import { orpc } from "@/utils/orpc";
import { AgentRowActions } from "./agent-row-actions";
import { AgentTokenCell } from "./agent-token-cell";
import { AgentWizard } from "./agent-wizard";
import { AgentsCardList } from "./agents-card-list";
import { AgentsSkeleton } from "./agents-skeleton";
import { TokenRevealDialog } from "./token-reveal-dialog";
import {
	useAgentMutations,
	useAgentWizard,
	useRevealToken,
} from "./use-agent-mutations";

const AVATAR_INITIALS_LENGTH = 2;

function matchAgent(row: AgentRow, query: string): boolean {
	return (
		row.name.toLowerCase().includes(query) ||
		row.providerId.toLowerCase().includes(query) ||
		row.modelId.toLowerCase().includes(query)
	);
}

function AgentRows({
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
	return (
		<TableBody>
			{rows.map((row) => (
				<TableRow key={row.id}>
					<TableCell>
						<div className="flex items-center gap-2">
							<Avatar size="sm">
								<AvatarImage alt={row.name} src={agentAvatar(row.id)} />
								<AvatarFallback>
									{row.name.slice(0, AVATAR_INITIALS_LENGTH).toUpperCase()}
								</AvatarFallback>
							</Avatar>
							<span className="font-medium">{row.name}</span>
						</div>
					</TableCell>
					<TableCell className="font-mono text-muted-foreground">
						{row.providerId}/{row.modelId}
					</TableCell>
					<TableCell>
						<AgentTokenCell agentId={row.id} />
					</TableCell>
					<TableCell className="text-right">
						<AgentRowActions
							onDelete={onDelete}
							onEdit={onEdit}
							onTokenRotated={onTokenRotated}
							row={row}
						/>
					</TableCell>
				</TableRow>
			))}
		</TableBody>
	);
}

function AgentsTable({
	view,
	onEdit,
	onDelete,
	onTokenRotated,
}: {
	view: ListView<AgentRow>;
	onEdit: (row: AgentRow) => void;
	onDelete: (id: string) => void;
	onTokenRotated: (token: string) => void;
}) {
	return (
		<Table>
			<TableHeader>
				<TableRow>
					<TableHead>Name</TableHead>
					<TableHead>Model</TableHead>
					<TableHead>Token</TableHead>
					<TableHead className="text-right">Actions</TableHead>
				</TableRow>
			</TableHeader>
			<AgentRows
				onDelete={onDelete}
				onEdit={onEdit}
				onTokenRotated={onTokenRotated}
				rows={view.pageRows}
			/>
		</Table>
	);
}

function AgentsResponsiveViews({
	view,
	openEdit,
	onDelete,
	onTokenRotated,
}: {
	view: ListView<AgentRow>;
	openEdit: (row: AgentRow) => void;
	onDelete: (id: string) => void;
	onTokenRotated: (token: string) => void;
}) {
	return (
		<>
			<div className="md:hidden">
				<AgentsCardList
					onDelete={onDelete}
					onEdit={openEdit}
					onTokenRotated={onTokenRotated}
					rows={view.pageRows}
				/>
			</div>
			<div className="hidden md:block">
				<AgentsTable
					onDelete={onDelete}
					onEdit={openEdit}
					onTokenRotated={onTokenRotated}
					view={view}
				/>
			</div>
		</>
	);
}

function AgentsListSection({
	view,
	openAdd,
	openEdit,
	onDelete,
	onTokenRotated,
}: {
	view: ListView<AgentRow>;
	openAdd: () => void;
	openEdit: (row: AgentRow) => void;
	onDelete: (id: string) => void;
	onTokenRotated: (token: string) => void;
}) {
	return (
		<>
			<ListToolbar
				action={
					<Button onClick={openAdd} size="sm">
						Add agent
					</Button>
				}
				onSearch={view.setSearch}
				placeholder="Search agents…"
				search={view.search}
			/>
			<AgentsResponsiveViews
				onDelete={onDelete}
				onTokenRotated={onTokenRotated}
				openEdit={openEdit}
				view={view}
			/>
			<Pagination
				onPage={view.setPage}
				page={view.page}
				pageCount={view.pageCount}
				total={view.total}
			/>
			<Button
				aria-label="Add agent"
				className={MOBILE_FAB_CLASS}
				onClick={openAdd}
				size="icon"
			>
				<PlusIcon className="size-5" />
			</Button>
		</>
	);
}

export function AgentsCard() {
	const agents = useQuery(orpc.agents.list.queryOptions());
	const view = useListView(agents.data ?? [], { filter: matchAgent });
	const { state, openAdd, openEdit, close } = useAgentWizard();
	const { revealToken, setRevealToken, handleTokenRotated } = useRevealToken();
	const { create, update, remove, submit } = useAgentMutations(
		() => close(false),
		setRevealToken
	);
	if (agents.isPending) {
		return <AgentsSkeleton />;
	}
	return (
		<div className="flex flex-col gap-3">
			<AgentsListSection
				onDelete={(id) => remove.mutate({ id })}
				onTokenRotated={handleTokenRotated}
				openAdd={openAdd}
				openEdit={openEdit}
				view={view}
			/>
			{state.open ? (
				<AgentWizard
					agentId={state.id}
					initial={state.initial}
					key={state.id ?? "new"}
					onOpenChange={close}
					onSubmit={(form) => submit(state.id, form)}
					open={state.open}
					pending={create.isPending || update.isPending}
				/>
			) : null}
			<TokenRevealDialog
				onClose={() => setRevealToken(null)}
				token={revealToken}
			/>
		</div>
	);
}
