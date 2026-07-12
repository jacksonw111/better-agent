import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@better-agent/ui/components/table";
import { DeleteConfirm } from "@/components/list/delete-confirm";
import { MemoryIdentity } from "./memory-identity";
import {
	type MemoryRow,
	memoryCreatedFormatter,
	memoryDescription,
} from "./memory-types";

const COLUMN_COUNT = 4;

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
				<MemoryIdentity memory={memory} />
			</TableCell>
			<TableCell className="max-w-64 truncate text-muted-foreground">
				{memoryDescription(memory)}
			</TableCell>
			<TableCell className="text-muted-foreground tabular-nums">
				{memoryCreatedFormatter.format(new Date(memory.createdAt))}
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
