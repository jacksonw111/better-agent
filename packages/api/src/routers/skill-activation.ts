import type { SkillRow } from "@better-agent/agent/ports";
import {
	collectUserTexts,
	findActiveSkill,
} from "@better-agent/agent/session/skill-activation";
import type { Context } from "../context";

// Skills T3 tool-folding: mirrors the activation the agent runtime derives in
// turn-messages.ts/skill-context.ts (see docs/web-agent-skills-plan.md — no
// new session-state column, just the latest `/skill-name` directive in the
// conversation). Reused here at the API layer because tool assembly
// (agent-tool-defs.ts) needs to know the active skill BEFORE the turn runs —
// runtime.ts only consumes an already-finalized ToolDef[], and only the API
// layer can resolve mcpServerIds into live McpServices (context.services.mcp).
//
// `currentText` is the just-submitted prompt, which at this point hasn't been
// persisted to the message store yet (persistUserTurn runs later, inside
// runtime.ts's executeTurn) — so it's passed in and appended to the stored
// history's user texts rather than re-fetched.

/** The active skill for this turn, or null if none of the agent's assigned
 * skills are activated (or the agent has none assigned). */
export async function resolveActiveSkill(
	context: Context,
	agentId: string,
	sessionId: string,
	currentText: string
): Promise<SkillRow | null> {
	const skills = await context.services.stores.skill.listAgentSkills(agentId);
	if (skills.length === 0) {
		return null;
	}
	const history =
		await context.services.stores.message.listWithParts(sessionId);
	const texts = [...collectUserTexts(history), currentText];
	return findActiveSkill(texts, skills);
}
