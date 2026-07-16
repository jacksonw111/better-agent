import { Button } from "@better-agent/ui/components/button";
import { formatBytes } from "@better-agent/ui/lib/format-bytes";
import { cn } from "@better-agent/ui/lib/utils";
import {
	FileIcon,
	FileTextIcon,
	ImageIcon,
	type LucideIcon,
	Trash2Icon,
} from "lucide-react";
import type { DateGroup } from "./date-groups";
import {
	documentTimeFormatter,
	type KnowledgeDocument,
} from "./knowledge-types";

const TEXTUAL_MIMES = new Set(["application/pdf", "application/json"]);

function docIcon(mime: string): LucideIcon {
	if (mime.startsWith("image/")) {
		return ImageIcon;
	}
	if (mime.startsWith("text/") || TEXTUAL_MIMES.has(mime)) {
		return FileTextIcon;
	}
	return FileIcon;
}

// One shared column template so the header, every group and every row align
// to the same grid: name | size | time | actions. Mobile collapses size/time
// into a sub-line under the name.
const ROW_GRID =
	"grid grid-cols-[minmax(0,1fr)_2rem] items-center gap-2 sm:grid-cols-[minmax(0,1fr)_6rem_7rem_2rem] sm:gap-3";

function ColumnHeader() {
	return (
		<div
			className={cn(
				ROW_GRID,
				"px-3 pb-1 font-medium text-muted-foreground text-xs"
			)}
		>
			<span>Name</span>
			<span className="hidden text-right sm:block">Size</span>
			<span className="hidden text-right sm:block">Uploaded</span>
			<span />
		</div>
	);
}

function RowDeleteButton({
	doc,
	onDelete,
}: {
	doc: KnowledgeDocument;
	onDelete: (doc: KnowledgeDocument) => void;
}) {
	return (
		<span className="flex justify-end">
			<Button
				aria-label={`Delete ${doc.name}`}
				className="transition-opacity sm:opacity-0 sm:group-hover:opacity-100 sm:focus-visible:opacity-100"
				onClick={() => onDelete(doc)}
				size="icon-xs"
				variant="ghost"
			>
				<Trash2Icon className="size-4" />
			</Button>
		</span>
	);
}

function DocumentRow({
	doc,
	onDelete,
	onOpen,
}: {
	doc: KnowledgeDocument;
	onDelete: (doc: KnowledgeDocument) => void;
	onOpen: (doc: KnowledgeDocument) => void;
}) {
	const Icon = docIcon(doc.mime);
	const size = formatBytes(doc.size);
	const time = documentTimeFormatter.format(new Date(doc.createdAt));
	return (
		<div
			className={cn(
				ROW_GRID,
				"group rounded-lg px-3 py-1.5 transition-colors hover:bg-muted/60"
			)}
		>
			<button
				className="flex min-w-0 items-center gap-3 rounded-md py-1 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
				onClick={() => onOpen(doc)}
				type="button"
			>
				<Icon
					aria-hidden="true"
					className="size-4 shrink-0 text-muted-foreground"
				/>
				<span className="min-w-0">
					<span className="block truncate text-sm">{doc.name}</span>
					<span className="block text-muted-foreground text-xs sm:hidden">
						{size} · {time}
					</span>
				</span>
			</button>
			<span className="hidden text-right text-muted-foreground text-xs tabular-nums sm:block">
				{size}
			</span>
			<span className="hidden text-right text-muted-foreground text-xs tabular-nums sm:block">
				{time}
			</span>
			<RowDeleteButton doc={doc} onDelete={onDelete} />
		</div>
	);
}

/** The documents of one page: a column header, then calendar-day groups whose
 * rows all share the header's grid, so Size/Uploaded stay column-aligned
 * across groups. */
export function DocumentGroups({
	groups,
	onDelete,
	onOpen,
}: {
	groups: DateGroup<KnowledgeDocument>[];
	onDelete: (doc: KnowledgeDocument) => void;
	onOpen: (doc: KnowledgeDocument) => void;
}) {
	return (
		<div className="flex flex-col gap-1">
			<ColumnHeader />
			{groups.map((group) => (
				<section className="flex flex-col gap-0.5 pt-2" key={group.label}>
					<h3 className="px-3 pb-1 font-medium text-muted-foreground text-xs">
						{group.label}
					</h3>
					{group.items.map((doc) => (
						<DocumentRow
							doc={doc}
							key={doc.id}
							onDelete={onDelete}
							onOpen={onOpen}
						/>
					))}
				</section>
			))}
		</div>
	);
}
