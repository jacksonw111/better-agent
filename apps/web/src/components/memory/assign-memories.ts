import { toast } from "sonner";
import { client } from "@/utils/orpc";
import type { MemoryTarget } from "./memory-types";

/** Links each memory to the target with the default read role (decision C2).
 * Used right after an agent/local agent is created, when the picker's selection
 * becomes real assignments. */
export async function assignMemoriesTo(
	target: MemoryTarget,
	memoryIds: string[]
): Promise<void> {
	await Promise.all(
		memoryIds.map((memoryId) =>
			client.memory.assignMemory({ ...target, memoryId, role: "read" })
		)
	);
}

/** assignMemoriesTo, but a failure only toasts — the agent itself was already
 * created, so the caller's success flow (navigate/close) must still proceed. */
export async function assignMemoriesSafely(
	target: MemoryTarget,
	memoryIds: string[]
): Promise<void> {
	if (memoryIds.length === 0) {
		return;
	}
	try {
		await assignMemoriesTo(target, memoryIds);
	} catch (error) {
		const message =
			error instanceof Error ? error.message : "Failed to assign memories";
		toast.error(message);
	}
}
