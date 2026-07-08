import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { orpc } from "@/utils/orpc";
import { MemoryListSkeleton } from "./memory-skeletons";
import { MemoryTable } from "./memory-table";

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

/** The user's memories as a table — one row per named knowledge base. Rows
 * link to the memory's detail page; the Actions cell deletes it (cascading its
 * items and assignments) after confirm. */
export function MemoryList() {
	const memories = useQuery(orpc.memory.listMemories.queryOptions());
	const deleteMemory = useDeleteMemory();

	if (memories.isPending) {
		return <MemoryListSkeleton />;
	}

	return (
		<MemoryTable
			memories={memories.data ?? []}
			onDelete={(id) => deleteMemory.mutate({ id })}
		/>
	);
}
