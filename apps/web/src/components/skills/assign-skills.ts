import { toast } from "sonner";
import { client } from "@/utils/orpc";

/** Links each skill to the agent. Used right after an agent is created, when
 * the picker's selection becomes real assignments (mirrors
 * assign-memories.ts's assignMemoriesTo, minus the role — skill assignment
 * is boolean, not read/read-write). */
export async function assignSkillsTo(
	agentId: string,
	skillIds: string[]
): Promise<void> {
	await Promise.all(
		skillIds.map((skillId) => client.skills.assignAgent({ agentId, skillId }))
	);
}

/** assignSkillsTo, but a failure only toasts — the agent itself was already
 * created, so the caller's success flow (navigate/close) must still proceed. */
export async function assignSkillsSafely(
	agentId: string,
	skillIds: string[]
): Promise<void> {
	if (skillIds.length === 0) {
		return;
	}
	try {
		await assignSkillsTo(agentId, skillIds);
	} catch (error) {
		const message =
			error instanceof Error ? error.message : "Failed to assign skills";
		toast.error(message);
	}
}
