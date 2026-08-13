import { Button } from "@better-agent/ui/components/button";
import { useQuery } from "@tanstack/react-query";
import { PlusIcon } from "lucide-react";
import { ListToolbar } from "@/components/list/list-toolbar";
import { MOBILE_FAB_CLASS } from "@/components/list/mobile-fab-class";
import { Pagination } from "@/components/list/pagination";
import { type ListView, useListView } from "@/components/list/use-list-view";
import { orpc } from "@/utils/orpc";
import { AgentWizard } from "./agent-wizard";
import { AgentsSkeleton } from "./agents-skeleton";
import { TokenRevealDialog } from "./token-reveal-dialog";
import {
	type AgentListRow,
	matchAgentRow,
	sortAgentRows,
} from "./unified-agent-row";
import {
	type AgentListEmptyCopy,
	AgentMobileList,
	type AgentRowCallbacks,
	AgentTable,
} from "./unified-agent-table";
import {
	useAgentMutations,
	useAgentWizard,
	useRevealToken,
} from "./use-agent-mutations";

// The /agents cloud-agent list.

const CLOUD_EMPTY: AgentListEmptyCopy = {
	body: "Add one to get started.",
	title: "No cloud agents yet",
};

/** The <md list and the md+ table, fed the same rows/callbacks — split out of
 * `AgentListSection` for the max-lines-per-function gate. */
function AgentListResponsiveViews({
	view,
	callbacks,
	empty,
}: {
	view: ListView<AgentListRow>;
	callbacks: AgentRowCallbacks;
	empty: AgentListEmptyCopy;
}) {
	return (
		<>
			<div className="md:hidden">
				<AgentMobileList
					callbacks={callbacks}
					empty={empty}
					rows={view.pageRows}
				/>
			</div>
			<div className="hidden md:block">
				<AgentTable callbacks={callbacks} empty={empty} rows={view.pageRows} />
			</div>
		</>
	);
}

/** The toolbar + responsive views + pagination + FAB frame. `onAdd` drives
 * the toolbar button and the mobile FAB alike. */
function AgentListSection({
	view,
	callbacks,
	empty,
	addLabel,
	onAdd,
}: {
	view: ListView<AgentListRow>;
	callbacks: AgentRowCallbacks;
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

/** The /agents list — cloud agent configs only. */
export function CloudAgentList() {
	const agents = useQuery(orpc.agents.list.queryOptions());
	const rows = sortAgentRows(agents.data ?? []);
	const view = useListView(rows, { filter: matchAgentRow });
	const wizard = useAgentWizard();
	const { revealToken, setRevealToken, handleTokenRotated } = useRevealToken();
	const { create, update, remove, submit } = useAgentMutations(
		() => wizard.close(false),
		setRevealToken
	);

	if (agents.isPending) {
		return <AgentsSkeleton />;
	}

	const callbacks: AgentRowCallbacks = {
		onDelete: (id) => remove.mutate({ id }),
		onEdit: wizard.openEdit,
		onTokenRotated: handleTokenRotated,
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
