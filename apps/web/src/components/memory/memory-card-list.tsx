import {
	Card,
	CardContent,
	CardFooter,
} from "@better-agent/ui/components/card";
import { EmptyState } from "@/components/layout/empty-state";
import { DeleteConfirm } from "@/components/list/delete-confirm";
import { MemoryIdentity } from "./memory-identity";
import type { MemoryRow } from "./memory-types";

const createdFormatter = new Intl.DateTimeFormat(undefined, {
	dateStyle: "medium",
});

function MemoryCard({
	memory,
	onDelete,
}: {
	memory: MemoryRow;
	onDelete: (id: string) => void;
}) {
	return (
		<Card>
			<CardContent className="flex flex-col gap-2">
				<MemoryIdentity memory={memory} />
				<div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-muted-foreground text-xs">
					<span className="truncate">
						{memory.description ?? "No description"}
					</span>
					<span>{createdFormatter.format(new Date(memory.createdAt))}</span>
				</div>
			</CardContent>
			<CardFooter className="justify-end">
				<DeleteConfirm
					label={`Delete ${memory.name}? All of its items and agent assignments are removed.`}
					onConfirm={() => onDelete(memory.id)}
				/>
			</CardFooter>
		</Card>
	);
}

/** The Memories list as a card-per-row list — the <md counterpart of
 * MemoryTable, sharing the exact same `memories`/`onDelete` so the two views
 * can't drift. */
export function MemoryCardList({
	memories,
	onDelete,
}: {
	memories: MemoryRow[];
	onDelete: (id: string) => void;
}) {
	if (memories.length === 0) {
		return (
			<EmptyState
				body="Create one to share knowledge across your agents."
				title="No memories yet"
			/>
		);
	}
	return (
		<div className="flex flex-col gap-3">
			{memories.map((memory) => (
				<MemoryCard key={memory.id} memory={memory} onDelete={onDelete} />
			))}
		</div>
	);
}
