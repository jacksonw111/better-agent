import { AssignedSkills } from "./assigned-skills";
import { SkillPicker } from "./skill-picker";

/**
 * The agent wizard's Skills step. Creating: a deferred multi-select — the
 * chosen skills are assigned right after the agent exists. Editing: the live
 * assignment panel (assign/unassign take effect immediately against the
 * existing agent). Mirrors MemoriesStep.
 */
export function SkillsStep({
	agentId,
	selected,
	onChange,
}: {
	agentId: string | null;
	selected: string[];
	onChange: (ids: string[]) => void;
}) {
	if (agentId) {
		return <AssignedSkills agentId={agentId} />;
	}
	return (
		<div className="flex flex-col gap-2">
			<SkillPicker onChange={onChange} selected={selected} />
			<p className="text-muted-foreground text-xs">
				Selected skills are assigned once the agent is created.
			</p>
		</div>
	);
}
