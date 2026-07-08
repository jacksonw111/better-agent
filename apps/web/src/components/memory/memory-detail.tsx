import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { orpc } from "@/utils/orpc";
import { AddItemComposer } from "./add-item-composer";
import { MemoryItems } from "./memory-items";
import { MemoryDetailSkeleton } from "./memory-skeletons";

function useDeleteItem() {
	const queryClient = useQueryClient();
	return useMutation(
		orpc.memory.deleteItem.mutationOptions({
			onSuccess: () => {
				queryClient.invalidateQueries({
					queryKey: orpc.memory.listItems.key(),
				});
			},
			onError: (error) => toast.error(error.message),
		})
	);
}

function NotFound() {
	return (
		<p className="rounded-lg bg-muted/40 p-6 text-center text-muted-foreground text-sm">
			This memory wasn't found — it may have been deleted, or the link is wrong.
		</p>
	);
}

/**
 * The `/memories/$memoryId` body: the memory's name + description, an
 * add-item composer, and its current items (soft-deletable). A future slice
 * adds an "Assigned to" section once the API exposes the memory→agents
 * direction (listAssigned currently only resolves agent→memories).
 */
export function MemoryDetail({ memoryId }: { memoryId: string }) {
	const memory = useQuery(
		orpc.memory.getMemory.queryOptions({ input: { id: memoryId } })
	);
	const items = useQuery(
		orpc.memory.listItems.queryOptions({ input: { memoryId } })
	);
	const deleteItem = useDeleteItem();

	if (memory.isPending || items.isPending) {
		return <MemoryDetailSkeleton />;
	}
	if (!memory.data) {
		return <NotFound />;
	}

	return (
		<div className="flex flex-col gap-4">
			<div className="flex flex-col gap-1">
				<h2 className="font-medium text-lg">{memory.data.name}</h2>
				{memory.data.description ? (
					<p className="text-muted-foreground text-sm">
						{memory.data.description}
					</p>
				) : null}
			</div>
			<AddItemComposer memoryId={memoryId} />
			<MemoryItems
				items={items.data ?? []}
				onDelete={(itemId) => deleteItem.mutate({ itemId })}
			/>
		</div>
	);
}
