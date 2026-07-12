import { Button } from "@better-agent/ui/components/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@better-agent/ui/components/dropdown-menu";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PlusIcon } from "lucide-react";
import type { ReactElement, ReactNode } from "react";
import { useState } from "react";
import { toast } from "sonner";
import { AddLocalAgentDialog } from "@/components/bridge/add-local-agent-dialog";
import { deriveLocalAgentEntries } from "@/components/bridge/local-agent-join";
import { withSessionPolling } from "@/components/bridge/local-agent-poll";
import { ListToolbar } from "@/components/list/list-toolbar";
import { MOBILE_FAB_CLASS } from "@/components/list/mobile-fab-class";
import { Pagination } from "@/components/list/pagination";
import { type ListView, useListView } from "@/components/list/use-list-view";
import type { BridgeSessionRow } from "@/utils/api-types";
import { orpc } from "@/utils/orpc";
import type { AgentForm } from "./agent-form";
import { AgentWizard } from "./agent-wizard";
import { AgentsSkeleton } from "./agents-skeleton";
import { TokenRevealDialog } from "./token-reveal-dialog";
import {
	matchUnifiedRow,
	mergeUnifiedRows,
	type UnifiedAgentRow,
} from "./unified-agent-row";
import {
	UnifiedAgentMobileList,
	UnifiedAgentTable,
	type UnifiedRowCallbacks,
} from "./unified-agent-table";
import {
	useAgentMutations,
	useAgentWizard,
	useRevealToken,
} from "./use-agent-mutations";

function countSessionsByToken(
	sessions: BridgeSessionRow[]
): Map<string, number> {
	const counts = new Map<string, number>();
	for (const session of sessions) {
		counts.set(session.tokenId, (counts.get(session.tokenId) ?? 0) + 1);
	}
	return counts;
}

function useDeleteLocalAgent() {
	const queryClient = useQueryClient();
	return useMutation(
		orpc.bridge.deleteToken.mutationOptions({
			onSuccess: () => {
				queryClient.invalidateQueries({
					queryKey: orpc.bridge.listTokens.key(),
				});
				queryClient.invalidateQueries({
					queryKey: orpc.bridge.listSessions.key(),
				});
			},
			onError: (error) => toast.error(error.message),
		})
	);
}

/** Loads and merges both agent sources into one newest-first list. Pending is
 * true only while BOTH sources are still loading, so one failing (or slow)
 * source never blanks the other's rows. */
function useUnifiedAgentRows(): {
	rows: UnifiedAgentRow[];
	isPending: boolean;
} {
	const agents = useQuery(orpc.agents.list.queryOptions());
	const tokens = useQuery(orpc.bridge.listTokens.queryOptions());
	const sessions = useQuery(
		withSessionPolling(orpc.bridge.listSessions.queryOptions())
	);
	const sessionData = sessions.data ?? [];
	const rows = mergeUnifiedRows(
		agents.data ?? [],
		deriveLocalAgentEntries(tokens.data ?? [], sessionData),
		countSessionsByToken(sessionData)
	);
	return { rows, isPending: agents.isPending && tokens.isPending };
}

/** The shared Add menu — one `DropdownMenu` per trigger (toolbar + FAB) that
 * branches into the cloud wizard or the local-agent dialog. */
function AddAgentMenu({
	renderTrigger,
	children,
	onAddCloud,
	onAddLocal,
}: {
	renderTrigger: ReactElement;
	children: ReactNode;
	onAddCloud: () => void;
	onAddLocal: () => void;
}) {
	return (
		<DropdownMenu>
			<DropdownMenuTrigger render={renderTrigger}>
				{children}
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end">
				<DropdownMenuItem onClick={onAddCloud}>Cloud Agent</DropdownMenuItem>
				<DropdownMenuItem onClick={onAddLocal}>Local Agent</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

function UnifiedAgentResponsiveViews({
	view,
	callbacks,
}: {
	view: ListView<UnifiedAgentRow>;
	callbacks: UnifiedRowCallbacks;
}) {
	return (
		<>
			<div className="md:hidden">
				<UnifiedAgentMobileList callbacks={callbacks} rows={view.pageRows} />
			</div>
			<div className="hidden md:block">
				<UnifiedAgentTable callbacks={callbacks} rows={view.pageRows} />
			</div>
		</>
	);
}

function UnifiedAgentListSection({
	view,
	callbacks,
	onAddCloud,
	onAddLocal,
}: {
	view: ListView<UnifiedAgentRow>;
	callbacks: UnifiedRowCallbacks;
	onAddCloud: () => void;
	onAddLocal: () => void;
}) {
	return (
		<>
			<ListToolbar
				action={
					<AddAgentMenu
						onAddCloud={onAddCloud}
						onAddLocal={onAddLocal}
						renderTrigger={<Button size="sm">Add agent</Button>}
					>
						Add agent
					</AddAgentMenu>
				}
				onSearch={view.setSearch}
				placeholder="Search agents…"
				search={view.search}
			/>
			<UnifiedAgentResponsiveViews callbacks={callbacks} view={view} />
			<Pagination
				onPage={view.setPage}
				page={view.page}
				pageCount={view.pageCount}
				total={view.total}
			/>
			<AddAgentMenu
				onAddCloud={onAddCloud}
				onAddLocal={onAddLocal}
				renderTrigger={
					<Button
						aria-label="Add agent"
						className={MOBILE_FAB_CLASS}
						size="icon"
					/>
				}
			>
				<PlusIcon className="size-5" />
			</AddAgentMenu>
		</>
	);
}

function UnifiedAgentDialogs({
	wizard,
	pending,
	onSubmit,
	revealToken,
	onRevealClose,
	localAddOpen,
	onLocalAddOpenChange,
}: {
	wizard: ReturnType<typeof useAgentWizard>;
	pending: boolean;
	onSubmit: (id: string | null, form: AgentForm) => void;
	revealToken: string | null;
	onRevealClose: () => void;
	localAddOpen: boolean;
	onLocalAddOpenChange: (open: boolean) => void;
}) {
	const { state, close } = wizard;
	return (
		<>
			{state.open ? (
				<AgentWizard
					agentId={state.id}
					initial={state.initial}
					key={state.id ?? "new"}
					onOpenChange={close}
					onSubmit={(form) => onSubmit(state.id, form)}
					open={state.open}
					pending={pending}
				/>
			) : null}
			<TokenRevealDialog onClose={onRevealClose} token={revealToken} />
			<AddLocalAgentDialog
				hideTrigger
				onOpenChange={onLocalAddOpenChange}
				open={localAddOpen}
			/>
		</>
	);
}

/** The merged Agents list — cloud agent configs and local bridge tokens in one
 * table, discriminated by a type badge. Rendered by the Agents route. */
export function UnifiedAgentList() {
	const { rows, isPending } = useUnifiedAgentRows();
	const view = useListView(rows, { filter: matchUnifiedRow });
	const deleteLocal = useDeleteLocalAgent();
	const wizard = useAgentWizard();
	const { revealToken, setRevealToken, handleTokenRotated } = useRevealToken();
	const { create, update, remove, submit } = useAgentMutations(
		() => wizard.close(false),
		setRevealToken
	);
	const [localAddOpen, setLocalAddOpen] = useState(false);

	if (isPending) {
		return <AgentsSkeleton />;
	}

	const callbacks: UnifiedRowCallbacks = {
		onCloudDelete: (id) => remove.mutate({ id }),
		onCloudEdit: wizard.openEdit,
		onCloudTokenRotated: handleTokenRotated,
		onLocalDelete: (tokenId) => deleteLocal.mutate({ id: tokenId }),
	};

	return (
		<div className="flex flex-col gap-3">
			<UnifiedAgentListSection
				callbacks={callbacks}
				onAddCloud={wizard.openAdd}
				onAddLocal={() => setLocalAddOpen(true)}
				view={view}
			/>
			<UnifiedAgentDialogs
				localAddOpen={localAddOpen}
				onLocalAddOpenChange={setLocalAddOpen}
				onRevealClose={() => setRevealToken(null)}
				onSubmit={submit}
				pending={create.isPending || update.isPending}
				revealToken={revealToken}
				wizard={wizard}
			/>
		</div>
	);
}
