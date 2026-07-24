import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { ListToolbar } from "@/components/list/list-toolbar";
import { Pagination } from "@/components/list/pagination";
import { useListView } from "@/components/list/use-list-view";
import { orpc } from "@/utils/orpc";
import { CreateMemoryDialog } from "./create-memory-dialog";
import { MemoryCardList } from "./memory-card-list";
import {
	matchesScopeFilter,
	type ProjectOption,
	SCOPE_FILTER_ALL,
	ScopeFilter,
	useProjectOptions,
} from "./memory-scope";
import { MemoryListSkeleton } from "./memory-skeletons";
import { MemoryTable } from "./memory-table";
import type { MemoryRow } from "./memory-types";

function useDeleteMemory() {
	const queryClient = useQueryClient();
	return useMutation(
		orpc.memory.deleteMemory.mutationOptions({
			onSuccess: () => {
				toast.success("Memory deleted");
				queryClient.invalidateQueries({
					queryKey: orpc.memory.listMemories.key(),
				});
			},
			onError: (error) => toast.error(error.message),
		})
	);
}

function matchMemory(row: MemoryRow, query: string): boolean {
	return (
		row.name.toLowerCase().includes(query) ||
		(row.description ?? "").toLowerCase().includes(query)
	);
}

/** The user's memories as a searchable table — one row per named knowledge
 * base. Rows link to the memory's detail page; the Actions cell deletes it
 * (cascading its items and assignments) after confirm. */
function MemoryToolbarAction({
	scope,
	onScope,
	projects,
}: {
	scope: string;
	onScope: (value: string) => void;
	projects: ProjectOption[];
}) {
	return (
		<div className="flex items-center gap-2">
			<ScopeFilter onValueChange={onScope} projects={projects} value={scope} />
			<CreateMemoryDialog />
		</div>
	);
}

export function MemoryList() {
	const memories = useQuery(orpc.memory.listMemories.queryOptions());
	const projects = useProjectOptions();
	const deleteMemory = useDeleteMemory();
	const [scope, setScope] = useState<string>(SCOPE_FILTER_ALL);
	const scoped = (memories.data ?? []).filter((memory) =>
		matchesScopeFilter(memory, scope)
	);
	const view = useListView(scoped, { filter: matchMemory });

	if (memories.isPending) {
		return <MemoryListSkeleton />;
	}

	return (
		<div className="flex flex-col gap-3">
			<ListToolbar
				action={
					<MemoryToolbarAction
						onScope={setScope}
						projects={projects}
						scope={scope}
					/>
				}
				onSearch={view.setSearch}
				placeholder="Search memories…"
				search={view.search}
			/>
			<div className="md:hidden">
				<MemoryCardList
					memories={view.pageRows}
					onDelete={(id) => deleteMemory.mutate({ id })}
					projects={projects}
				/>
			</div>
			<div className="hidden md:block">
				<MemoryTable
					memories={view.pageRows}
					onDelete={(id) => deleteMemory.mutate({ id })}
					projects={projects}
				/>
			</div>
			<Pagination
				onPage={view.setPage}
				page={view.page}
				pageCount={view.pageCount}
				total={view.total}
			/>
		</div>
	);
}
