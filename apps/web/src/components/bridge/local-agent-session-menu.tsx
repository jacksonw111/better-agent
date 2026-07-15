import { Button } from "@better-agent/ui/components/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@better-agent/ui/components/dialog";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@better-agent/ui/components/dropdown-menu";
import { ArchiveIcon, EllipsisIcon, Trash2Icon, XIcon } from "lucide-react";
import { useState } from "react";

// P3-T1: the session row's "⋯" action menu — the plan's three-option delete
// flow (archive / delete permanently / cancel). Deleting is destructive and
// irreversible, so it goes through the confirm dialog below; archiving is the
// safe default and applies immediately.

/** Confirmation for the irreversible hard delete. Shared with the archived
 * view's per-row delete, so both delete paths confirm the same way. */
export function DeleteSessionDialog({
	onConfirm,
	onOpenChange,
	open,
	title,
}: {
	onConfirm: () => void;
	onOpenChange: (open: boolean) => void;
	open: boolean;
	title: string;
}) {
	return (
		<Dialog onOpenChange={onOpenChange} open={open}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>Delete session permanently?</DialogTitle>
					<DialogDescription>
						“{title}” and its message history will be removed. This cannot be
						undone.
					</DialogDescription>
				</DialogHeader>
				<DialogFooter>
					<Button
						onClick={() => onOpenChange(false)}
						size="sm"
						variant="outline"
					>
						Cancel
					</Button>
					<Button
						onClick={() => {
							onOpenChange(false);
							onConfirm();
						}}
						size="sm"
						variant="destructive"
					>
						Delete permanently
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

/** The menu's three options — archive (safe, immediate), delete (routes into
 * the confirm dialog), cancel (just closes, like Escape). */
function SessionMenuItems({
	onArchive,
	onRequestDelete,
}: {
	onArchive: () => void;
	onRequestDelete: () => void;
}) {
	return (
		<DropdownMenuContent align="end" className="min-w-44">
			<DropdownMenuItem onClick={onArchive}>
				<ArchiveIcon className="size-3.5" />
				Archive
			</DropdownMenuItem>
			<DropdownMenuItem onClick={onRequestDelete} variant="destructive">
				<Trash2Icon className="size-3.5" />
				Delete permanently
			</DropdownMenuItem>
			<DropdownMenuItem>
				<XIcon className="size-3.5" />
				Cancel
			</DropdownMenuItem>
		</DropdownMenuContent>
	);
}

/** The row-level "⋯" menu: Archive / Delete permanently / Cancel. The confirm
 * dialog is a SIBLING of the DropdownMenu (state owned here), because Base UI
 * unmounts the menu content on close — the same pattern as
 * TerminalHeaderOverflowMenu's Settings dialog. */
export function LocalAgentSessionMenu({
	onArchive,
	onDelete,
	title,
}: {
	onArchive: () => void;
	onDelete: () => void;
	title: string;
}) {
	const [confirmOpen, setConfirmOpen] = useState(false);
	return (
		<>
			<DropdownMenu>
				<DropdownMenuTrigger
					render={
						<button
							aria-label={`More actions for ${title}`}
							className="rounded-md p-2 text-muted-foreground transition-opacity hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100 aria-expanded:opacity-100 md:p-1.5 md:opacity-0"
							type="button"
						/>
					}
				>
					<EllipsisIcon className="size-3.5" />
				</DropdownMenuTrigger>
				<SessionMenuItems
					onArchive={onArchive}
					onRequestDelete={() => setConfirmOpen(true)}
				/>
			</DropdownMenu>
			<DeleteSessionDialog
				onConfirm={onDelete}
				onOpenChange={setConfirmOpen}
				open={confirmOpen}
				title={title}
			/>
		</>
	);
}
