import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { ListToolbar } from "@/components/list/list-toolbar";
import { Pagination } from "@/components/list/pagination";
import { useListView } from "@/components/list/use-list-view";
import { orpc } from "@/utils/orpc";
import { CreateSkillDialog } from "./create-skill-dialog";
import { EditSkillDialog } from "./edit-skill-dialog";
import { SkillCardList } from "./skill-card-list";
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

function matchSkill(row: SkillRow, query: string): boolean {
	return (
		row.name.toLowerCase().includes(query) ||
		(row.description ?? "").toLowerCase().includes(query)
	);
}

/** The user's skills as a searchable table — one row per reusable playbook.
 * Clicking a row's name opens the edit dialog; the Actions cell deletes it
 * (unassigning it from every agent) after confirm. */
export function SkillList() {
	const skills = useQuery(orpc.skills.list.queryOptions());
	const deleteSkill = useDeleteSkill();
	const [editing, setEditing] = useState<SkillRow | null>(null);
	const view = useListView(skills.data ?? [], { filter: matchSkill });

	if (skills.isPending) {
		return <SkillListSkeleton />;
	}

	return (
		<div className="flex flex-col gap-3">
			<ListToolbar
				action={<CreateSkillDialog />}
				onSearch={view.setSearch}
				placeholder="Search skills…"
				search={view.search}
			/>
			<div className="md:hidden">
				<SkillCardList
					onDelete={(id) => deleteSkill.mutate({ skillId: id })}
					onEdit={setEditing}
					skills={view.pageRows}
				/>
			</div>
			<div className="hidden md:block">
				<SkillTable
					onDelete={(id) => deleteSkill.mutate({ skillId: id })}
					onEdit={setEditing}
					skills={view.pageRows}
				/>
			</div>
			<Pagination
				onPage={view.setPage}
				page={view.page}
				pageCount={view.pageCount}
				total={view.total}
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
		</div>
	);
}
