import { Checkbox } from "@better-agent/ui/components/checkbox";
import { Label } from "@better-agent/ui/components/label";
import { Skeleton } from "@better-agent/ui/components/skeleton";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { orpc } from "@/utils/orpc";
import type { SkillRow } from "./skill-types";

const LOADING_KEYS = ["s1", "s2"] as const;

function PickerRow({
	skill,
	checked,
	onToggle,
}: {
	skill: SkillRow;
	checked: boolean;
	onToggle: (id: string, checked: boolean) => void;
}) {
	return (
		<Label className="flex items-start gap-2 font-normal">
			<Checkbox
				checked={checked}
				onCheckedChange={(next) => onToggle(skill.id, next === true)}
			/>
			<span className="flex min-w-0 flex-col">
				<span className="truncate">{skill.name}</span>
				{skill.description ? (
					<span className="truncate text-muted-foreground text-xs">
						{skill.description}
					</span>
				) : null}
			</span>
		</Label>
	);
}

/** A multi-select over the user's skills (checkbox list) — mirrors
 * MemoryPicker exactly. Selections become agent assignments once the owning
 * agent exists; the picker itself only collects ids. */
export function SkillPicker({
	selected,
	onChange,
}: {
	selected: string[];
	onChange: (ids: string[]) => void;
}) {
	const skills = useQuery(orpc.skills.list.queryOptions());

	if (skills.isPending) {
		return (
			<div className="flex flex-col gap-2">
				{LOADING_KEYS.map((key) => (
					<Skeleton className="h-4 w-40" key={key} />
				))}
			</div>
		);
	}

	const rows = skills.data ?? [];
	if (rows.length === 0) {
		return (
			<p className="text-muted-foreground text-sm">
				No skills yet.{" "}
				<Link className="underline hover:text-foreground" to="/skills">
					Create one on the Skills page
				</Link>{" "}
				to give this agent a reusable playbook.
			</p>
		);
	}

	const toggle = (id: string, checked: boolean) =>
		onChange(
			checked ? [...selected, id] : selected.filter((value) => value !== id)
		);

	return (
		<div className="flex max-h-40 flex-col gap-2 overflow-y-auto">
			{rows.map((skill) => (
				<PickerRow
					checked={selected.includes(skill.id)}
					key={skill.id}
					onToggle={toggle}
					skill={skill}
				/>
			))}
		</div>
	);
}
