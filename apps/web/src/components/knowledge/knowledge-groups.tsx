import {
	FileIcon,
	FileTextIcon,
	ImageIcon,
	type LucideIcon,
} from "lucide-react";
import { DeleteConfirm } from "@/components/list/delete-confirm";
import type { DateGroup } from "./date-groups";
import {
	documentTimeFormatter,
	formatBytes,
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

function DocumentRow({
	doc,
	onDelete,
	onOpen,
}: {
	doc: KnowledgeDocument;
	onDelete: (id: string) => void;
	onOpen: (doc: KnowledgeDocument) => void;
}) {
	const Icon = docIcon(doc.mime);
	return (
		<div className="flex items-center gap-1 rounded-lg px-2 py-1.5 transition-colors hover:bg-muted/60">
			<button
				className="flex min-w-0 flex-1 items-center gap-3 rounded-md px-1 py-1 text-left"
				onClick={() => onOpen(doc)}
				type="button"
			>
				<Icon
					aria-hidden="true"
					className="size-4 shrink-0 text-muted-foreground"
				/>
				<span className="min-w-0 flex-1">
					<span className="block truncate text-sm">{doc.name}</span>
					<span className="block text-muted-foreground text-xs">
						{formatBytes(doc.size)} ·{" "}
						{documentTimeFormatter.format(new Date(doc.createdAt))}
					</span>
				</span>
			</button>
			<DeleteConfirm
				label="Delete this document?"
				onConfirm={() => onDelete(doc.id)}
			/>
		</div>
	);
}

/** The documents of one page, bucketed by calendar day. */
export function DocumentGroups({
	groups,
	onDelete,
	onOpen,
}: {
	groups: DateGroup<KnowledgeDocument>[];
	onDelete: (id: string) => void;
	onOpen: (doc: KnowledgeDocument) => void;
}) {
	return (
		<div className="flex flex-col gap-4">
			{groups.map((group) => (
				<section className="flex flex-col gap-1" key={group.label}>
					<h3 className="px-3 font-medium text-muted-foreground text-xs">
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
