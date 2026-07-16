import {
	buildSearchTool,
	DEFER_THRESHOLD,
	SEARCH_TOOL_NAME,
} from "../tool/tool-search";
import {
	buildSkillTool,
	SKILL_TOOL_NAME,
	type SkillActivation,
} from "../tool/tool-skill";
import type { ToolDef } from "../tool/types";

// The `skill` control tool + pre-reveal of a user-activated skill's tools.
function addSkillControl(
	skills: SkillActivation[],
	activeSkillName: string | undefined,
	active: Set<string>,
	controls: ToolDef[]
): void {
	active.add(SKILL_TOOL_NAME);
	controls.push(buildSkillTool(skills, active));
	const activeSkill = skills.find((s) => s.name === activeSkillName);
	for (const name of activeSkill?.toolNames ?? []) {
		active.add(name);
	}
}

/**
 * Assemble the turn's tool set. Deferred tool schemas are reached through
 * search_tools; assigned skills are loaded (playbook + tools) via the `skill`
 * tool. Both control tools mutate one shared `active` set that prepareStep feeds
 * the model each step; a skill the user activated via /name is pre-revealed.
 */
export function prepareToolBinding(
	tools: ToolDef[] | undefined,
	skills: SkillActivation[] | undefined,
	activeSkillName: string | undefined
): { activeNames?: () => string[]; defs: ToolDef[] } {
	const toolDefs = [...(tools ?? [])];
	const deferred = toolDefs.filter((def) => def.defer);
	const hasSkills = (skills?.length ?? 0) > 0;
	// Nothing to gate: below the defer threshold and no skills.
	if (deferred.length <= DEFER_THRESHOLD && !hasSkills) {
		return { defs: toolDefs };
	}
	const active = new Set(
		toolDefs.filter((def) => !def.defer).map((def) => def.name)
	);
	const controls: ToolDef[] = [];
	if (deferred.length > 0) {
		active.add(SEARCH_TOOL_NAME);
		controls.push(buildSearchTool(deferred, active));
	}
	if (skills && hasSkills) {
		addSkillControl(skills, activeSkillName, active, controls);
	}
	return { defs: [...toolDefs, ...controls], activeNames: () => [...active] };
}
