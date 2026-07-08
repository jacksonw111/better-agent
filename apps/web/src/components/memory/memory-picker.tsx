import { Checkbox } from "@better-agent/ui/components/checkbox";
import { Label } from "@better-agent/ui/components/label";
import { Skeleton } from "@better-agent/ui/components/skeleton";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { orpc } from "@/utils/orpc";
import type { MemoryRow } from "./memory-types";

const LOADING_KEYS = ["m1", "m2"] as const;

function PickerRow({
	memory,
	checked,
	onToggle,
}: {
	memory: MemoryRow;
	checked: boolean;
	onToggle: (id: string, checked: boolean) => void;
}) {
	return (
		<Label className="flex items-start gap-2 font-normal">
			<Checkbox
				checked={checked}
				onCheckedChange={(next) => onToggle(memory.id, next === true)}
			/>
			<span className="flex min-w-0 flex-col">
				<span className="truncate">{memory.name}</span>
				{memory.description ? (
					<span className="truncate text-muted-foreground text-xs">
						{memory.description}
					</span>
				) : null}
			</span>
		</Label>
	);
}

/** A multi-select over the user's memories (checkbox list). Selections become
 * read-role assignments once the owning agent exists — the picker itself only
 * collects ids. */
export function MemoryPicker({
	selected,
	onChange,
}: {
	selected: string[];
	onChange: (ids: string[]) => void;
}) {
	const memories = useQuery(orpc.memory.listMemories.queryOptions());

	if (memories.isPending) {
		return (
			<div className="flex flex-col gap-2">
				{LOADING_KEYS.map((key) => (
					<Skeleton className="h-4 w-40" key={key} />
				))}
			</div>
		);
	}

	const rows = memories.data ?? [];
	if (rows.length === 0) {
		return (
			<p className="text-muted-foreground text-sm">
				No memories yet.{" "}
				<Link className="underline hover:text-foreground" to="/memories">
					Create one on the Memories page
				</Link>{" "}
				to share knowledge with this agent.
			</p>
		);
	}

	const toggle = (id: string, checked: boolean) =>
		onChange(
			checked ? [...selected, id] : selected.filter((value) => value !== id)
		);

	return (
		<div className="flex max-h-40 flex-col gap-2 overflow-y-auto">
			{rows.map((memory) => (
				<PickerRow
					checked={selected.includes(memory.id)}
					key={memory.id}
					memory={memory}
					onToggle={toggle}
				/>
			))}
		</div>
	);
}
