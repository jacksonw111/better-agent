import { Button } from "@better-agent/ui/components/button";
import { Skeleton } from "@better-agent/ui/components/skeleton";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PlusIcon, XIcon } from "lucide-react";
import { toast } from "sonner";
import { orpc } from "@/utils/orpc";
import type {
	AssignedMemoryRow,
	MemoryRole,
	MemoryTarget,
} from "./memory-types";

const ROLE_LABEL: Record<MemoryRole, string> = {
	read: "read",
	read_write: "read & write",
};

function useAssignmentMutations(target: MemoryTarget) {
	const queryClient = useQueryClient();
	const invalidate = () =>
		queryClient.invalidateQueries({
			queryKey: orpc.memory.listAssigned.key(),
		});
	const assign = useMutation(
		orpc.memory.assignMemory.mutationOptions({
			onSuccess: invalidate,
			onError: (error) => toast.error(error.message),
		})
	);
	const unassign = useMutation(
		orpc.memory.unassignMemory.mutationOptions({
			onSuccess: invalidate,
			onError: (error) => toast.error(error.message),
		})
	);
	return {
		assign: (memoryId: string, role: MemoryRole) =>
			assign.mutate({ ...target, memoryId, role }),
		unassign: (memoryId: string) => unassign.mutate({ ...target, memoryId }),
		pending: assign.isPending || unassign.isPending,
	};
}

/** One assigned memory: name, a role toggle (read ⇄ read & write — assign is
 * an upsert, so re-assigning with the other role flips it) and unassign. */
function AssignedRow({
	row,
	onRole,
	onUnassign,
}: {
	row: AssignedMemoryRow;
	onRole: (memoryId: string, role: MemoryRole) => void;
	onUnassign: (memoryId: string) => void;
}) {
	const name = row.name ?? "Deleted memory";
	const nextRole: MemoryRole = row.role === "read" ? "read_write" : "read";
	return (
		<li className="flex items-center gap-2 rounded-md border px-3 py-2">
			<span className="min-w-0 flex-1 truncate text-sm">{name}</span>
			<Button
				aria-label={`Toggle write access for ${name}`}
				aria-pressed={row.role === "read_write"}
				className="text-muted-foreground text-xs"
				onClick={() => onRole(row.memoryId, nextRole)}
				size="xs"
				title="Toggle write access"
				variant="outline"
			>
				{ROLE_LABEL[row.role]}
			</Button>
			<Button
				aria-label={`Unassign ${name}`}
				onClick={() => onUnassign(row.memoryId)}
				size="icon-xs"
				title="Unassign"
				variant="ghost"
			>
				<XIcon className="size-4" />
			</Button>
		</li>
	);
}

function AssignControls({
	options,
	onAssign,
}: {
	options: { id: string; name: string }[];
	onAssign: (memoryId: string) => void;
}) {
	if (options.length === 0) {
		return null;
	}
	return (
		<div className="flex flex-col gap-1.5">
			<p className="text-muted-foreground text-xs">Assign a memory</p>
			<div className="flex flex-wrap gap-1.5">
				{options.map((option) => (
					<Button
						key={option.id}
						onClick={() => onAssign(option.id)}
						size="xs"
						variant="outline"
					>
						<PlusIcon className="size-3.5" />
						{option.name}
					</Button>
				))}
			</div>
		</div>
	);
}

/** The memories assigned to one agent (web or local): each with its role
 * (default read; toggleable to read & write) and an unassign action, plus
 * one-click assignment of the user's remaining memories. */
export function AssignedMemories({ target }: { target: MemoryTarget }) {
	const assigned = useQuery(
		orpc.memory.listAssigned.queryOptions({ input: target })
	);
	const memories = useQuery(orpc.memory.listMemories.queryOptions());
	const { assign, unassign } = useAssignmentMutations(target);

	if (assigned.isPending || memories.isPending) {
		return <Skeleton className="h-16 w-full rounded-md" />;
	}

	const rows = assigned.data ?? [];
	const assignedIds = new Set(rows.map((row) => row.memoryId));
	const options = (memories.data ?? []).filter(
		(memory) => !assignedIds.has(memory.id)
	);

	return (
		<div className="flex flex-col gap-3">
			{rows.length === 0 ? (
				<p className="text-muted-foreground text-sm">
					No memories assigned yet.
				</p>
			) : (
				<ul className="flex flex-col gap-1.5">
					{rows.map((row) => (
						<AssignedRow
							key={row.memoryId}
							onRole={assign}
							onUnassign={unassign}
							row={row}
						/>
					))}
				</ul>
			)}
			<AssignControls onAssign={(id) => assign(id, "read")} options={options} />
		</div>
	);
}
