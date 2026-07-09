import { log } from "evlog";
import type { SkillRow, SkillStore } from "../ports";
import { collectUserTexts, findActiveSkill } from "./skill-activation";
import type { MessageWithParts } from "./types";

// Skills T3: each turn, injects a compact index of the agent's assigned
// skills (always, when non-empty) plus the full instructions of whichever
// skill is currently ACTIVE (derived from the latest `/skill-name` directive
// in the conversation — see skill-activation.ts). Both blocks live in the
// system prompt, so they ride the same Anthropic cacheControl breakpoint the
// system message already gets (packages/agent/src/provider/cache-policy.ts)
// — no separate caching code needed here.

function formatSkillIndex(skills: SkillRow[]): string {
	const lines = skills.map(
		(skill) =>
			`- ${skill.name}: ${skill.description ?? ""}   (invoke with /${skill.name})`
	);
	return `## Available skills\n${lines.join("\n")}`;
}

function formatActiveSkillBlock(skill: SkillRow): string {
	return `## Active skill: ${skill.name}\n${skill.instructions ?? ""}`;
}

/** Returns the skills block to inject into the system prompt, or null when
 * there's nothing to show: no assigned skills, or a lookup failure (never
 * breaks the turn — logged and swallowed, like buildMemoryContext). */
export async function buildSkillContext(
	skillStore: SkillStore,
	agentId: string,
	history: MessageWithParts[]
): Promise<string | null> {
	try {
		const skills = await skillStore.listAgentSkills(agentId);
		if (skills.length === 0) {
			return null;
		}
		const index = formatSkillIndex(skills);
		const active = findActiveSkill(collectUserTexts(history), skills);
		return active ? `${index}\n\n${formatActiveSkillBlock(active)}` : index;
	} catch (error) {
		log.error({
			action: "skill-context failed",
			agentId,
			error: error instanceof Error ? error.message : String(error),
		});
		return null;
	}
}
