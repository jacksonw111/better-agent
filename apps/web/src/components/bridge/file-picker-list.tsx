import { cn } from "@better-agent/ui/lib/utils";
import { FileIcon, FolderIcon } from "lucide-react";
import type { FsEntry } from "./fs-events";

// P4-T3: the @file picker dropdown — purely presentational, the fs-channel
// sibling of slash-picker-list.tsx (same above-the-composer placement, same
// mousedown-preserves-focus selection).

function FilePickerRow({
	active,
	entry,
	itemId,
	onHover,
	onSelect,
}: {
	active: boolean;
	entry: FsEntry;
	itemId: string;
	onHover: () => void;
	onSelect: () => void;
}) {
	const Icon = entry.type === "dir" ? FolderIcon : FileIcon;
	return (
		<button
			aria-selected={active}
			className={cn(
				"flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-sm",
				active ? "bg-accent text-accent-foreground" : "hover:bg-accent/60"
			)}
			id={itemId}
			onMouseDown={(event) => {
				// Same trick as SlashPickerRow: intercept at mousedown so selecting
				// by mouse never first blurs the textarea.
				event.preventDefault();
				onSelect();
			}}
			onMouseEnter={onHover}
			role="option"
			type="button"
		>
			<Icon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
			<span className="truncate">
				{entry.type === "dir" ? `${entry.name}/` : entry.name}
			</span>
		</button>
	);
}

export function FilePickerList({
	activeIndex,
	itemDomId,
	items,
	listId,
	onHover,
	onSelect,
}: {
	activeIndex: number;
	itemDomId: (index: number) => string;
	items: FsEntry[];
	listId: string;
	onHover: (index: number) => void;
	onSelect: (item: FsEntry) => void;
}) {
	return (
		<div
			className="absolute inset-x-0 bottom-full z-20 mb-2 max-h-64 overflow-y-auto rounded-lg border bg-popover p-1 text-popover-foreground shadow-md"
			id={listId}
			role="listbox"
		>
			<div className="px-2 pt-1.5 pb-1 font-medium text-muted-foreground text-xs uppercase tracking-wide">
				Files
			</div>
			{items.map((item, index) => (
				<FilePickerRow
					active={index === activeIndex}
					entry={item}
					itemId={itemDomId(index)}
					key={`${item.type}-${item.name}`}
					onHover={() => onHover(index)}
					onSelect={() => onSelect(item)}
				/>
			))}
		</div>
	);
}
