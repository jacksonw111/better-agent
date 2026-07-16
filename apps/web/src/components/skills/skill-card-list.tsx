import {
	Card,
	CardContent,
	CardFooter,
} from "@better-agent/ui/components/card";
import { EmptyState } from "@/components/layout/empty-state";
import { DeleteConfirm } from "@/components/list/delete-confirm";
import { SkillIdentity } from "./skill-identity";
import type { SkillRow } from "./skill-types";

const createdFormatter = new Intl.DateTimeFormat(undefined, {
	dateStyle: "medium",
});

function SkillCard({
	skill,
	onEdit,
	onDelete,
}: {
	skill: SkillRow;
	onEdit: (skill: SkillRow) => void;
	onDelete: (id: string) => void;
}) {
	return (
		<Card>
			<CardContent className="flex flex-col gap-2">
				<SkillIdentity onEdit={onEdit} skill={skill} />
				<div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-muted-foreground text-xs">
					<span className="truncate">
						{skill.description ?? "No description"}
					</span>
					<span>{createdFormatter.format(new Date(skill.createdAt))}</span>
				</div>
			</CardContent>
			<CardFooter className="justify-end">
				{skill.isBuiltin ? (
					<span className="text-muted-foreground text-xs">内置 · 只读</span>
				) : (
					<DeleteConfirm
						label={`Delete ${skill.name}? It's unassigned from every agent it's linked to.`}
						onConfirm={() => onDelete(skill.id)}
					/>
				)}
			</CardFooter>
		</Card>
	);
}

/** The Skills list as a card-per-row list — the <md counterpart of
 * SkillTable, sharing the exact same `skills`/callbacks so the two views
 * can't drift. */
export function SkillCardList({
	skills,
	onEdit,
	onDelete,
}: {
	skills: SkillRow[];
	onEdit: (skill: SkillRow) => void;
	onDelete: (id: string) => void;
}) {
	if (skills.length === 0) {
		return (
			<EmptyState
				body="Create one to give your agents a reusable playbook."
				title="No skills yet"
			/>
		);
	}
	return (
		<div className="flex flex-col gap-3">
			{skills.map((skill) => (
				<SkillCard
					key={skill.id}
					onDelete={onDelete}
					onEdit={onEdit}
					skill={skill}
				/>
			))}
		</div>
	);
}
