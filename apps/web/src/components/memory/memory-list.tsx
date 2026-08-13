import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ListToolbar } from "@/components/list/list-toolbar";
import { Pagination } from "@/components/list/pagination";
import { useListView } from "@/components/list/use-list-view";
import { orpc } from "@/utils/orpc";
import { CreateMemoryDialog } from "./create-memory-dialog";
import { MemoryCardList } from "./memory-card-list";
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
export function MemoryList() {
	const memories = useQuery(orpc.memory.listMemories.queryOptions());
	const deleteMemory = useDeleteMemory();
	const view = useListView(memories.data ?? [], { filter: matchMemory });

	if (memories.isPending) {
		return <MemoryListSkeleton />;
	}

	return (
		<div className="flex flex-col gap-3">
			<ListToolbar
				action={<CreateMemoryDialog />}
				onSearch={view.setSearch}
				placeholder="Search memories…"
				search={view.search}
			/>
			<div className="md:hidden">
				<MemoryCardList
					memories={view.pageRows}
					onDelete={(id) => deleteMemory.mutate({ id })}
				/>
			</div>
			<div className="hidden md:block">
				<MemoryTable
					memories={view.pageRows}
					onDelete={(id) => deleteMemory.mutate({ id })}
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
