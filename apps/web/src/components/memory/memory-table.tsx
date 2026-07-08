import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@better-agent/ui/components/table";
import { useNavigate } from "@tanstack/react-router";
import { BookMarkedIcon } from "lucide-react";
import { DeleteConfirm } from "@/components/list/delete-confirm";
import type { MemoryRow } from "./memory-types";

const COLUMN_COUNT = 4;

const createdFormatter = new Intl.DateTimeFormat(undefined, {
	dateStyle: "medium",
});

/** The memory identity cell: its NAME is the only navigation target in the
 * row (same convention as the local-agent table), so the description and date
 * stay plain and freely selectable. */
function MemoryCell({ memory }: { memory: MemoryRow }) {
	const navigate = useNavigate();
	return (
		<div className="flex min-w-0 items-center gap-2">
			<BookMarkedIcon className="size-4 shrink-0 text-muted-foreground" />
			<button
				className="truncate text-left font-medium hover:underline"
				onClick={() =>
					navigate({
						params: { memoryId: memory.id },
						to: "/memories/$memoryId",
					})
				}
				type="button"
			>
				{memory.name}
			</button>
		</div>
	);
}

function MemoryTableRow({
	memory,
	onDelete,
}: {
	memory: MemoryRow;
	onDelete: (id: string) => void;
}) {
	return (
		<TableRow>
			<TableCell>
				<MemoryCell memory={memory} />
			</TableCell>
			<TableCell className="max-w-64 truncate text-muted-foreground">
				{memory.description ?? "—"}
			</TableCell>
			<TableCell className="text-muted-foreground tabular-nums">
				{createdFormatter.format(new Date(memory.createdAt))}
			</TableCell>
			<TableCell className="text-right">
				<DeleteConfirm
					label={`Delete ${memory.name}? All of its items and agent assignments are removed.`}
					onConfirm={() => onDelete(memory.id)}
				/>
			</TableCell>
		</TableRow>
	);
}

/** The Memories list as a table: one row per memory with its description and
 * created date. The name links to the memory's detail page; the Actions cell
 * deletes the memory (after confirm — the API cascades items + assignments). */
export function MemoryTable({
	memories,
	onDelete,
}: {
	memories: MemoryRow[];
	onDelete: (id: string) => void;
}) {
	return (
		<Table>
			<TableHeader>
				<TableRow>
					<TableHead>Name</TableHead>
					<TableHead>Description</TableHead>
					<TableHead>Created</TableHead>
					<TableHead className="text-right">Actions</TableHead>
				</TableRow>
			</TableHeader>
			<TableBody>
				{memories.length === 0 ? (
					<TableRow>
						<TableCell
							className="h-24 text-center text-muted-foreground"
							colSpan={COLUMN_COUNT}
						>
							No memories yet — create one to share knowledge across your
							agents.
						</TableCell>
					</TableRow>
				) : (
					memories.map((memory) => (
						<MemoryTableRow
							key={memory.id}
							memory={memory}
							onDelete={onDelete}
						/>
					))
				)}
			</TableBody>
		</Table>
	);
}
