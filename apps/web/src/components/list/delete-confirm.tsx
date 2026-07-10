import { Button } from "@better-agent/ui/components/button";
import {
	Popover,
	PopoverContent,
	PopoverTitle,
	PopoverTrigger,
} from "@better-agent/ui/components/popover";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@better-agent/ui/components/tooltip";
import { Trash2Icon } from "lucide-react";
import { useState } from "react";

export function DeleteConfirm({
	onConfirm,
	label = "Delete this item?",
}: {
	onConfirm: () => void;
	label?: string;
}) {
	const [open, setOpen] = useState(false);
	return (
		<Popover onOpenChange={setOpen} open={open}>
			<Tooltip>
				<TooltipTrigger
					render={
						<PopoverTrigger
							render={
								<Button aria-label="Delete" size="icon-xs" variant="ghost" />
							}
						/>
					}
				>
					<Trash2Icon className="size-4" />
				</TooltipTrigger>
				<TooltipContent>Delete</TooltipContent>
			</Tooltip>
			<PopoverContent>
				<PopoverTitle className="text-sm">{label}</PopoverTitle>
				<div className="mt-2 flex justify-end gap-2">
					<Button onClick={() => setOpen(false)} size="xs" variant="outline">
						Cancel
					</Button>
					<Button
						onClick={() => {
							setOpen(false);
							onConfirm();
						}}
						size="xs"
						variant="destructive"
					>
						Confirm
					</Button>
				</div>
			</PopoverContent>
		</Popover>
	);
}
