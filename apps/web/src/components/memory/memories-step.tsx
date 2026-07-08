import { AssignedMemories } from "./assigned-memories";
import { MemoryPicker } from "./memory-picker";

/**
 * The agent wizard's Memories step. Creating: a deferred multi-select — the
 * chosen memories are assigned (role read) right after the agent exists.
 * Editing: the live assignment panel (assign/unassign/toggle role take effect
 * immediately against the existing agent).
 */
export function MemoriesStep({
	agentId,
	selected,
	onChange,
}: {
	agentId: string | null;
	selected: string[];
	onChange: (ids: string[]) => void;
}) {
	if (agentId) {
		return <AssignedMemories target={{ agentId }} />;
	}
	return (
		<div className="flex flex-col gap-2">
			<MemoryPicker onChange={onChange} selected={selected} />
			<p className="text-muted-foreground text-xs">
				Selected memories are assigned with read access — you can grant write
				access after the agent is created.
			</p>
		</div>
	);
}
