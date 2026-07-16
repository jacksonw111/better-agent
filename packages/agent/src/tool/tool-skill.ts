import type { ToolDef } from "./types";

// Progressive disclosure for SKILLS (the same idea as tool-search for tools):
// the model sees a lightweight index of skill names + descriptions, and calls
// `skill({ name })` to load one — which returns the skill's full playbook AND
// reveals its tools (adds them to the shared `active` set, so the deferred
// schemas become callable on the next step, exactly like search_tools). This
// matches how opencode's `skill` tool works: discovery is cheap, the body loads
// only on demand.

export const SKILL_TOOL_NAME = "skill";

/** One assignable skill, resolved to what the `skill` tool needs at call time. */
export interface SkillActivation {
	description: string;
	instructions: string;
	name: string;
	/** Tool names this skill's playbook uses — revealed when the skill loads. */
	toolNames: string[];
}

function runLoad(
	args: unknown,
	skills: SkillActivation[],
	active: Set<string>
): { isError?: boolean; output: string } {
	const name = (args as { name?: unknown }).name;
	const skill =
		typeof name === "string" ? skills.find((s) => s.name === name) : undefined;
	if (!skill) {
		return {
			isError: true,
			output: `No skill named "${String(name)}". Available skills: ${skills
				.map((s) => s.name)
				.join(", ")}`,
		};
	}
	for (const toolName of skill.toolNames) {
		active.add(toolName);
	}
	const toolNote =
		skill.toolNames.length > 0
			? `\n\n---\nThese tools are now available — call them directly: ${skill.toolNames.join(
					", "
				)}`
			: "";
	return {
		output: `# Skill: ${skill.name}\n\n${skill.instructions}${toolNote}`,
	};
}

/** Build the `skill` tool over the agent's assignable skills + the turn's
 * shared active-tool set (mutated on load so revealed tools become callable). */
export function buildSkillTool(
	skills: SkillActivation[],
	active: Set<string>
): ToolDef {
	const index = skills.map((s) => `- ${s.name}: ${s.description}`).join("\n");
	return {
		name: SKILL_TOOL_NAME,
		description:
			"Load a skill: fetch its playbook (step-by-step instructions for a " +
			"repeatable task) and make its tools available to call. When the task " +
			"matches a skill below, load it FIRST and follow its playbook. Available " +
			`skills:\n${index}`,
		parameters: {
			type: "object",
			properties: {
				name: {
					type: "string",
					description: "The exact skill name to load (from the list above).",
				},
			},
			required: ["name"],
		},
		execute: (args) => Promise.resolve(runLoad(args, skills, active)),
	};
}
