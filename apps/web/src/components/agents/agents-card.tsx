import { CopyAction } from "@better-agent/ui/components/actions";
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
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { ListToolbar } from "@/components/list/list-toolbar";
import { Pagination } from "@/components/list/pagination";
import { type ListView, useListView } from "@/components/list/use-list-view";
import { assignMemoriesSafely } from "@/components/memory/assign-memories";
import type { AgentRow } from "@/utils/api-types";
import { agentAvatar } from "@/utils/avatar";
import { celebrateSuccess } from "@/utils/celebrate";
import { orpc } from "@/utils/orpc";
import { type AgentForm, agentRowToForm, toAgentInput } from "./agent-form";
import { AgentRowActions } from "./agent-row-actions";
import { AgentWizard } from "./agent-wizard";
import { AgentsSkeleton } from "./agents-skeleton";
import { TokenRevealDialog } from "./token-reveal-dialog";

const TOKEN_PREVIEW_LEN = 14;
const AVATAR_INITIALS_LENGTH = 2;

function matchAgent(row: AgentRow, query: string): boolean {
	return (
		row.name.toLowerCase().includes(query) ||
		row.providerId.toLowerCase().includes(query) ||
		row.modelId.toLowerCase().includes(query)
	);
}

function TokenCell({ agentId }: { agentId: string }) {
	const tokenQuery = useQuery(
		orpc.agents.getToken.queryOptions({ input: { id: agentId } })
	);
	const token = tokenQuery.data ?? null;
	if (!token) {
		return <span className="text-muted-foreground text-xs">—</span>;
	}
	return (
		<div className="flex items-center gap-1">
			<code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
				{token.slice(0, TOKEN_PREVIEW_LEN)}…
			</code>
			<CopyAction label="Copy token" text={token} />
		</div>
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
						<TokenCell agentId={row.id} />
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
		<>
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
			<Pagination
				onPage={view.setPage}
				page={view.page}
				pageCount={view.pageCount}
				total={view.total}
			/>
		</>
	);
}

function useAgentWizard() {
	const [state, setState] = useState<{
		open: boolean;
		id: string | null;
		initial: AgentForm | null;
	}>({ open: false, id: null, initial: null });
	const openAdd = () => setState({ open: true, id: null, initial: null });
	const openEdit = (row: AgentRow) =>
		setState({ open: true, id: row.id, initial: agentRowToForm(row) });
	const close = (open: boolean) => setState((s) => ({ ...s, open }));
	return { state, openAdd, openEdit, close };
}

function useCreateAgent({
	pendingMemoryIds,
	onTokenMinted,
	onSaved,
	invalidate,
}: {
	pendingMemoryIds: { current: string[] };
	onTokenMinted: (token: string) => void;
	onSaved: () => void;
	invalidate: () => void;
}) {
	return useMutation(
		orpc.agents.create.mutationOptions({
			onSuccess: async (result) => {
				await assignMemoriesSafely(
					{ agentId: result.agent.id },
					pendingMemoryIds.current
				);
				pendingMemoryIds.current = [];
				celebrateSuccess("Agent created");
				onTokenMinted(result.token);
				onSaved();
				invalidate();
			},
			onError: (error) => toast.error(error.message),
		})
	);
}

function useAgentMutations(
	onSaved: () => void,
	onTokenMinted: (token: string) => void
) {
	const queryClient = useQueryClient();
	const invalidate = () =>
		queryClient.invalidateQueries({ queryKey: orpc.agents.list.key() });
	// The Memories step's selection, captured at submit time so the create
	// mutation's onSuccess can turn it into real assignments (the agent id only
	// exists after the create round-trip).
	const pendingMemoryIds = useRef<string[]>([]);
	const create = useCreateAgent({
		invalidate,
		onSaved,
		onTokenMinted,
		pendingMemoryIds,
	});
	const update = useMutation(
		orpc.agents.update.mutationOptions({
			onSuccess: () => {
				celebrateSuccess("Agent updated");
				onSaved();
				invalidate();
			},
			onError: (error) => toast.error(error.message),
		})
	);
	const remove = useMutation(
		orpc.agents.delete.mutationOptions({
			onSuccess: () => {
				toast.success("Agent deleted");
				invalidate();
			},
			onError: (error) => toast.error(error.message),
		})
	);
	const submit = (editingId: string | null, form: AgentForm) => {
		const input = toAgentInput(form);
		if (editingId === null) {
			pendingMemoryIds.current = form.memoryIds;
			create.mutate(input);
		} else {
			update.mutate({ id: editingId, ...input });
		}
	};
	return { create, update, remove, submit };
}

function useRevealToken() {
	const queryClient = useQueryClient();
	const [revealToken, setRevealToken] = useState<string | null>(null);
	const handleTokenRotated = (token: string) => {
		setRevealToken(token);
		queryClient.invalidateQueries({ queryKey: orpc.agents.getToken.key() });
	};
	return { revealToken, setRevealToken, handleTokenRotated };
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
			<AgentsTable
				onDelete={(id) => remove.mutate({ id })}
				onEdit={openEdit}
				onTokenRotated={handleTokenRotated}
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
