import { Button } from "@better-agent/ui/components/button";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PlusIcon } from "lucide-react";
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
import { AgentWizard } from "./agent-wizard";
import { AgentsSkeleton } from "./agents-skeleton";
import { TokenRevealDialog } from "./token-reveal-dialog";
import {
	matchUnifiedRow,
	mergeUnifiedRows,
	type UnifiedAgentRow,
} from "./unified-agent-row";
import {
	type AgentListEmptyCopy,
	UnifiedAgentMobileList,
	UnifiedAgentTable,
	type UnifiedRowCallbacks,
} from "./unified-agent-table";
import {
	useAgentMutations,
	useAgentWizard,
	useRevealToken,
} from "./use-agent-mutations";

const noop = (): void => undefined;

/** mergeUnifiedRows never consults the counts map when there are no local
 * entries — a shared empty map keeps the cloud list allocation-free. */
const NO_SESSION_COUNTS: Map<string, number> = new Map();

const CLOUD_EMPTY: AgentListEmptyCopy = {
	body: "Add one to get started.",
	title: "No cloud agents yet",
};

const LOCAL_EMPTY: AgentListEmptyCopy = {
	body: "Connect one from your machine to get started.",
	title: "No local agents yet",
};

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

function AgentListResponsiveViews({
	view,
	callbacks,
	empty,
}: {
	view: ListView<UnifiedAgentRow>;
	callbacks: UnifiedRowCallbacks;
	empty: AgentListEmptyCopy;
}) {
	return (
		<>
			<div className="md:hidden">
				<UnifiedAgentMobileList
					callbacks={callbacks}
					empty={empty}
					rows={view.pageRows}
				/>
			</div>
			<div className="hidden md:block">
				<UnifiedAgentTable
					callbacks={callbacks}
					empty={empty}
					rows={view.pageRows}
				/>
			</div>
		</>
	);
}

/** The toolbar + responsive views + pagination + FAB frame both pages share.
 * `onAdd` drives the toolbar button and the mobile FAB alike. */
function AgentListSection({
	view,
	callbacks,
	empty,
	addLabel,
	onAdd,
}: {
	view: ListView<UnifiedAgentRow>;
	callbacks: UnifiedRowCallbacks;
	empty: AgentListEmptyCopy;
	addLabel: string;
	onAdd: () => void;
}) {
	return (
		<>
			<ListToolbar
				action={
					<Button onClick={onAdd} size="sm">
						{addLabel}
					</Button>
				}
				onSearch={view.setSearch}
				placeholder="Search agents…"
				search={view.search}
			/>
			<AgentListResponsiveViews
				callbacks={callbacks}
				empty={empty}
				view={view}
			/>
			<Pagination
				onPage={view.setPage}
				page={view.page}
				pageCount={view.pageCount}
				total={view.total}
			/>
			<Button
				aria-label={addLabel}
				className={MOBILE_FAB_CLASS}
				onClick={onAdd}
				size="icon"
			>
				<PlusIcon className="size-5" />
			</Button>
		</>
	);
}

/** The /agents list — cloud agent configs only. Local agents moved to the
 * /local workspace (P0 route split); this list no longer merges them in. */
export function CloudAgentList() {
	const agents = useQuery(orpc.agents.list.queryOptions());
	const rows = mergeUnifiedRows(agents.data ?? [], [], NO_SESSION_COUNTS);
	const view = useListView(rows, { filter: matchUnifiedRow });
	const wizard = useAgentWizard();
	const { revealToken, setRevealToken, handleTokenRotated } = useRevealToken();
	const { create, update, remove, submit } = useAgentMutations(
		() => wizard.close(false),
		setRevealToken
	);

	if (agents.isPending) {
		return <AgentsSkeleton />;
	}

	const callbacks: UnifiedRowCallbacks = {
		onCloudDelete: (id) => remove.mutate({ id }),
		onCloudEdit: wizard.openEdit,
		onCloudTokenRotated: handleTokenRotated,
		onLocalDelete: noop,
	};

	return (
		<div className="flex flex-col gap-3">
			<AgentListSection
				addLabel="Add agent"
				callbacks={callbacks}
				empty={CLOUD_EMPTY}
				onAdd={wizard.openAdd}
				view={view}
			/>
			{wizard.state.open ? (
				<AgentWizard
					agentId={wizard.state.id}
					initial={wizard.state.initial}
					key={wizard.state.id ?? "new"}
					onOpenChange={wizard.close}
					onSubmit={(form) => submit(wizard.state.id, form)}
					open={wizard.state.open}
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

/** The /local list — bridge tokens only, one row per connected local agent. */
export function LocalAgentList() {
	const tokens = useQuery(orpc.bridge.listTokens.queryOptions());
	const sessions = useQuery(
		withSessionPolling(orpc.bridge.listSessions.queryOptions())
	);
	const sessionData = sessions.data ?? [];
	const rows = mergeUnifiedRows(
		[],
		deriveLocalAgentEntries(tokens.data ?? [], sessionData),
		countSessionsByToken(sessionData)
	);
	const view = useListView(rows, { filter: matchUnifiedRow });
	const deleteLocal = useDeleteLocalAgent();
	const [addOpen, setAddOpen] = useState(false);

	if (tokens.isPending) {
		return <AgentsSkeleton />;
	}

	const callbacks: UnifiedRowCallbacks = {
		onCloudDelete: noop,
		onCloudEdit: noop,
		onCloudTokenRotated: noop,
		onLocalDelete: (tokenId) => deleteLocal.mutate({ id: tokenId }),
	};

	return (
		<div className="flex flex-col gap-3">
			<AgentListSection
				addLabel="Connect agent"
				callbacks={callbacks}
				empty={LOCAL_EMPTY}
				onAdd={() => setAddOpen(true)}
				view={view}
			/>
			<AddLocalAgentDialog
				hideTrigger
				onOpenChange={setAddOpen}
				open={addOpen}
			/>
		</div>
	);
}
