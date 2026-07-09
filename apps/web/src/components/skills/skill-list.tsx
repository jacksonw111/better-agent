import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { orpc } from "@/utils/orpc";
import { EditSkillDialog } from "./edit-skill-dialog";
import { SkillListSkeleton } from "./skill-skeletons";
import { SkillTable } from "./skill-table";
import type { SkillRow } from "./skill-types";

function useDeleteSkill() {
	const queryClient = useQueryClient();
	return useMutation(
		orpc.skills.delete.mutationOptions({
			onSuccess: () => {
				toast.success("Skill deleted");
				queryClient.invalidateQueries({ queryKey: orpc.skills.list.key() });
			},
			onError: (error) => toast.error(error.message),
		})
	);
}

/** The user's skills as a table — one row per reusable playbook. Clicking a
 * row's name opens the edit dialog; the Actions cell deletes it (unassigning
 * it from every agent) after confirm. */
export function SkillList() {
	const skills = useQuery(orpc.skills.list.queryOptions());
	const deleteSkill = useDeleteSkill();
	const [editing, setEditing] = useState<SkillRow | null>(null);

	if (skills.isPending) {
		return <SkillListSkeleton />;
	}

	return (
		<>
			<SkillTable
				onDelete={(id) => deleteSkill.mutate({ skillId: id })}
				onEdit={setEditing}
				skills={skills.data ?? []}
			/>
			{editing ? (
				<EditSkillDialog
					onOpenChange={(open) => {
						if (!open) {
							setEditing(null);
						}
					}}
					open={editing !== null}
					skill={editing}
				/>
			) : null}
		</>
	);
}
