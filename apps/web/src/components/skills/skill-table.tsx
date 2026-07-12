import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@better-agent/ui/components/table";
import { DeleteConfirm } from "@/components/list/delete-confirm";
import { SkillIdentity } from "./skill-identity";
import type { SkillRow } from "./skill-types";

const COLUMN_COUNT = 4;

const createdFormatter = new Intl.DateTimeFormat(undefined, {
	dateStyle: "medium",
});

function SkillTableRow({
	skill,
	onEdit,
	onDelete,
}: {
	skill: SkillRow;
	onEdit: (skill: SkillRow) => void;
	onDelete: (id: string) => void;
}) {
	return (
		<TableRow>
			<TableCell>
				<SkillIdentity onEdit={onEdit} skill={skill} />
			</TableCell>
			<TableCell className="max-w-64 truncate text-muted-foreground">
				{skill.description ?? "—"}
			</TableCell>
			<TableCell className="text-muted-foreground tabular-nums">
				{createdFormatter.format(new Date(skill.createdAt))}
			</TableCell>
			<TableCell className="text-right">
				<DeleteConfirm
					label={`Delete ${skill.name}? It's unassigned from every agent it's linked to.`}
					onConfirm={() => onDelete(skill.id)}
				/>
			</TableCell>
		</TableRow>
	);
}

/** The Skills list as a table: one row per skill with its description and
 * created date. The name opens the edit dialog; the Actions cell deletes the
 * skill (after confirm — the API cascades agent assignments). */
export function SkillTable({
	skills,
	onEdit,
	onDelete,
}: {
	skills: SkillRow[];
	onEdit: (skill: SkillRow) => void;
	onDelete: (id: string) => void;
}) {
	return (
		<Table>
			<TableHeader>
				<TableRow>
					<TableHead>Name</TableHead>
					<TableHead>Description</TableHead>
					<TableHead>Created</TableHead>
					<TableHead className="text-right">Actions</TableHead>
				</TableRow>
			</TableHeader>
			<TableBody>
				{skills.length === 0 ? (
					<TableRow>
						<TableCell
							className="h-24 text-center text-muted-foreground"
							colSpan={COLUMN_COUNT}
						>
							No skills yet — create one to give your agents a reusable
							playbook.
						</TableCell>
					</TableRow>
				) : (
					skills.map((skill) => (
						<SkillTableRow
							key={skill.id}
							onDelete={onDelete}
							onEdit={onEdit}
							skill={skill}
						/>
					))
				)}
			</TableBody>
		</Table>
	);
}
