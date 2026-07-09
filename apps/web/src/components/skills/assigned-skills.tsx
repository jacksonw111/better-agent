import { Button } from "@better-agent/ui/components/button";
import { Skeleton } from "@better-agent/ui/components/skeleton";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PlusIcon, XIcon } from "lucide-react";
import { toast } from "sonner";
import { orpc } from "@/utils/orpc";
import type { SkillRow } from "./skill-types";

function useAssignmentMutations(agentId: string) {
	const queryClient = useQueryClient();
	const invalidate = () =>
		queryClient.invalidateQueries({
			queryKey: orpc.skills.listAssigned.key(),
		});
	const assign = useMutation(
		orpc.skills.assignAgent.mutationOptions({
			onSuccess: invalidate,
			onError: (error) => toast.error(error.message),
		})
	);
	const unassign = useMutation(
		orpc.skills.unassignAgent.mutationOptions({
			onSuccess: invalidate,
			onError: (error) => toast.error(error.message),
		})
	);
	return {
		assign: (skillId: string) => assign.mutate({ agentId, skillId }),
		unassign: (skillId: string) => unassign.mutate({ agentId, skillId }),
	};
}

/** One assigned skill: name and an unassign action (no role toggle — a skill
 * is either assigned to an agent or it isn't, unlike memories' read/read &
 * write). */
function AssignedRow({
	skill,
	onUnassign,
}: {
	skill: SkillRow;
	onUnassign: (skillId: string) => void;
}) {
	return (
		<li className="flex items-center gap-2 overflow-hidden rounded-md border px-3 py-2">
			<span className="min-w-0 flex-1 truncate text-sm">{skill.name}</span>
			<Button
				aria-label={`Unassign ${skill.name}`}
				onClick={() => onUnassign(skill.id)}
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
	options: SkillRow[];
	onAssign: (skillId: string) => void;
}) {
	if (options.length === 0) {
		return null;
	}
	return (
		<div className="flex flex-col gap-1.5">
			<p className="text-muted-foreground text-xs">Assign a skill</p>
			<div className="flex flex-wrap gap-1.5">
				{options.map((skill) => (
					<Button
						key={skill.id}
						onClick={() => onAssign(skill.id)}
						size="xs"
						variant="outline"
					>
						<PlusIcon className="size-3.5" />
						{skill.name}
					</Button>
				))}
			</div>
		</div>
	);
}

/** The skills assigned to one (web) agent, plus one-click assignment of the
 * user's remaining skills. Mirrors AssignedMemories, minus the role toggle —
 * skill assignment is boolean. */
export function AssignedSkills({ agentId }: { agentId: string }) {
	const assigned = useQuery(
		orpc.skills.listAssigned.queryOptions({ input: { agentId } })
	);
	const skills = useQuery(orpc.skills.list.queryOptions());
	const { assign, unassign } = useAssignmentMutations(agentId);

	if (assigned.isPending || skills.isPending) {
		return <Skeleton className="h-16 w-full rounded-md" />;
	}

	const rows = assigned.data ?? [];
	const assignedIds = new Set(rows.map((row) => row.id));
	const options = (skills.data ?? []).filter(
		(skill) => !assignedIds.has(skill.id)
	);

	return (
		<div className="flex flex-col gap-3">
			{rows.length === 0 ? (
				<p className="text-muted-foreground text-sm">No skills assigned yet.</p>
			) : (
				<ul className="flex flex-col gap-1.5">
					{rows.map((skill) => (
						<AssignedRow key={skill.id} onUnassign={unassign} skill={skill} />
					))}
				</ul>
			)}
			<AssignControls onAssign={assign} options={options} />
		</div>
	);
}
