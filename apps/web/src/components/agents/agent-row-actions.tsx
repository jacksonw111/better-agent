import { Button } from "@better-agent/ui/components/button";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@better-agent/ui/components/tooltip";
import { Link } from "@tanstack/react-router";
import { MessageSquareIcon, PencilIcon } from "lucide-react";
import { DeleteConfirm } from "@/components/list/delete-confirm";
import type { AgentRow } from "@/utils/api-types";
import { RegenerateToken } from "./agent-token-controls";

interface RowActionProps {
	onDelete: (id: string) => void;
	onEdit: (row: AgentRow) => void;
	onTokenRotated: (token: string) => void;
	row: AgentRow;
}

// All actions are icon buttons (hover shows a tooltip) for a consistent row.
export function AgentRowActions({
	row,
	onEdit,
	onDelete,
	onTokenRotated,
}: RowActionProps) {
	return (
		<div className="flex justify-end gap-1">
			<Tooltip>
				<TooltipTrigger
					render={
						<Button
							aria-label="Chat with agent"
							render={<Link search={{ agentId: row.id }} to="/chat" />}
							size="icon-xs"
							variant="ghost"
						/>
					}
				>
					<MessageSquareIcon className="size-4" />
				</TooltipTrigger>
				<TooltipContent>Chat with agent</TooltipContent>
			</Tooltip>
			<Tooltip>
				<TooltipTrigger
					render={
						<Button
							aria-label="Edit agent"
							onClick={() => onEdit(row)}
							size="icon-xs"
							variant="ghost"
						/>
					}
				>
					<PencilIcon className="size-4" />
				</TooltipTrigger>
				<TooltipContent>Edit agent</TooltipContent>
			</Tooltip>
			<RegenerateToken agentId={row.id} onToken={onTokenRotated} />
			<DeleteConfirm
				label="Delete this agent?"
				onConfirm={() => onDelete(row.id)}
			/>
		</div>
	);
}
