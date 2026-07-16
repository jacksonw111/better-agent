import { Button } from "@better-agent/ui/components/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@better-agent/ui/components/dialog";
import { Loader2Icon } from "lucide-react";

/** Modal confirmation for destructive actions — deletes get a real dialog
 * with an explicit Cancel/confirm pair, not a hover popover. The dialog
 * refuses to close while the action is pending so state can't get lost. */
export function ConfirmDialog({
	confirmLabel = "Delete",
	description,
	onConfirm,
	onOpenChange,
	open,
	pending = false,
	title,
}: {
	confirmLabel?: string;
	description: string;
	onConfirm: () => void;
	onOpenChange: (open: boolean) => void;
	open: boolean;
	pending?: boolean;
	title: string;
}) {
	return (
		<Dialog
			onOpenChange={(next) => {
				if (!pending) {
					onOpenChange(next);
				}
			}}
			open={open}
		>
			<DialogContent className="sm:max-w-sm">
				<DialogHeader>
					<DialogTitle>{title}</DialogTitle>
					<DialogDescription>{description}</DialogDescription>
				</DialogHeader>
				<DialogFooter>
					<Button
						disabled={pending}
						onClick={() => onOpenChange(false)}
						variant="outline"
					>
						Cancel
					</Button>
					<Button disabled={pending} onClick={onConfirm} variant="destructive">
						{pending ? <Loader2Icon className="size-4 animate-spin" /> : null}
						{confirmLabel}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
