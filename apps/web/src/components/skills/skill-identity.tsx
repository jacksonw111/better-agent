import { Badge } from "@better-agent/ui/components/badge";
import { Wand2Icon } from "lucide-react";
import type { SkillRow } from "./skill-types";

/** The skill identity block shared by the table row and the mobile card:
 * clicking its NAME opens the edit dialog in both views (a skill has no
 * detail page of its own), so they can't drift. Built-in skills are org
 * templates — read-only, so their name is plain text with a 内置 badge. */
export function SkillIdentity({
	skill,
	onEdit,
}: {
	skill: SkillRow;
	onEdit: (skill: SkillRow) => void;
}) {
	return (
		<div className="flex min-w-0 items-center gap-2">
			<Wand2Icon className="size-4 shrink-0 text-muted-foreground" />
			{skill.isBuiltin ? (
				<>
					<span className="truncate font-medium">{skill.name}</span>
					<Badge className="shrink-0" variant="secondary">
						内置
					</Badge>
				</>
			) : (
				<button
					className="truncate text-left font-medium hover:underline"
					onClick={() => onEdit(skill)}
					type="button"
				>
					{skill.name}
				</button>
			)}
		</div>
	);
}
