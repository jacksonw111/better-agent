import { Badge } from "@better-agent/ui/components/badge";
import { DeleteConfirm } from "@/components/list/delete-confirm";
import type { MemoryItemRow } from "./memory-types";

const createdFormatter = new Intl.DateTimeFormat(undefined, {
	dateStyle: "medium",
});

const IMPORTANCE_DECIMALS = 2;

const SOURCE_LABEL: Record<MemoryItemRow["source"], string> = {
	user: "user",
	extracted: "extracted",
	reflection: "reflection",
};

function formatImportance(importance: number): string {
	return String(Number(importance.toFixed(IMPORTANCE_DECIMALS)));
}

function ItemRow({
	item,
	onDelete,
}: {
	item: MemoryItemRow;
	onDelete: (itemId: string) => void;
}) {
	return (
		<li className="flex flex-col gap-2 rounded-lg border bg-muted/20 p-4">
			<p className="whitespace-pre-wrap text-sm">{item.content}</p>
			<div className="flex items-center gap-3 text-muted-foreground text-xs">
				<Badge variant="outline">{SOURCE_LABEL[item.source]}</Badge>
				<span className="tabular-nums">
					importance {formatImportance(item.importance)}
				</span>
				<span className="tabular-nums">
					{createdFormatter.format(new Date(item.createdAt))}
				</span>
				<div className="ml-auto">
					<DeleteConfirm
						label="Delete this item? It drops out of retrieval but stays in history."
						onConfirm={() => onDelete(item.id)}
					/>
				</div>
			</div>
		</li>
	);
}

/** The current (non-deleted) items of a memory, newest first: content, source
 * badge, importance and created date, with a per-item soft-delete. */
export function MemoryItems({
	items,
	onDelete,
}: {
	items: MemoryItemRow[];
	onDelete: (itemId: string) => void;
}) {
	if (items.length === 0) {
		return (
			<p className="rounded-lg bg-muted/40 p-6 text-center text-muted-foreground text-sm">
				No items yet — add the first fact above.
			</p>
		);
	}
	return (
		<ul className="flex flex-col gap-2">
			{items.map((item) => (
				<ItemRow item={item} key={item.id} onDelete={onDelete} />
			))}
		</ul>
	);
}
