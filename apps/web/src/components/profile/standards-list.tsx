import { Button } from "@better-agent/ui/components/button";
import { Switch } from "@better-agent/ui/components/switch";
import { ChevronDownIcon, ChevronUpIcon, PencilIcon } from "lucide-react";
import { DeleteConfirm } from "@/components/list/delete-confirm";
import type { ProfileStandard } from "@/utils/api-types";

const BODY_PREVIEW_MAX = 140;

function bodyPreview(body: string): string {
	const oneLine = body.replace(/\s+/g, " ").trim();
	return oneLine.length > BODY_PREVIEW_MAX
		? `${oneLine.slice(0, BODY_PREVIEW_MAX)}…`
		: oneLine;
}

interface RowCallbacks {
	onDelete: (id: string) => void;
	onEdit: (standard: ProfileStandard) => void;
	onMove: (id: string, direction: -1 | 1) => void;
	onToggle: (standard: ProfileStandard, enabled: boolean) => void;
}

function ReorderButtons({
	standard,
	isFirst,
	isLast,
	onMove,
}: {
	standard: ProfileStandard;
	isFirst: boolean;
	isLast: boolean;
	onMove: RowCallbacks["onMove"];
}) {
	return (
		<div className="flex flex-col">
			<Button
				aria-label={`Move ${standard.title} up`}
				disabled={isFirst}
				onClick={() => onMove(standard.id, -1)}
				size="icon-xs"
				variant="ghost"
			>
				<ChevronUpIcon className="size-4" />
			</Button>
			<Button
				aria-label={`Move ${standard.title} down`}
				disabled={isLast}
				onClick={() => onMove(standard.id, 1)}
				size="icon-xs"
				variant="ghost"
			>
				<ChevronDownIcon className="size-4" />
			</Button>
		</div>
	);
}

function StandardRow({
	standard,
	isFirst,
	isLast,
	callbacks,
}: {
	standard: ProfileStandard;
	isFirst: boolean;
	isLast: boolean;
	callbacks: RowCallbacks;
}) {
	return (
		<div className="flex items-start gap-3 rounded-xl bg-muted/40 p-3">
			<ReorderButtons
				isFirst={isFirst}
				isLast={isLast}
				onMove={callbacks.onMove}
				standard={standard}
			/>
			<div className="min-w-0 flex-1">
				<p className="truncate font-medium text-sm">{standard.title}</p>
				<p className="text-muted-foreground text-xs">
					{bodyPreview(standard.body) || "No rule text"}
				</p>
			</div>
			<div className="flex shrink-0 items-center gap-1">
				<Switch
					aria-label={`Enable ${standard.title}`}
					checked={standard.enabled}
					onCheckedChange={(checked) =>
						callbacks.onToggle(standard, checked === true)
					}
				/>
				<Button
					aria-label={`Edit ${standard.title}`}
					onClick={() => callbacks.onEdit(standard)}
					size="icon-xs"
					variant="ghost"
				>
					<PencilIcon className="size-4" />
				</Button>
				<DeleteConfirm
					label={`Delete "${standard.title}"?`}
					onConfirm={() => callbacks.onDelete(standard.id)}
				/>
			</div>
		</div>
	);
}

/** The ordered list of standards. Sort order is what the CLI writes into the
 * managed CLAUDE.md block, so up/down here is meaningful, not cosmetic. */
export function StandardsList({
	standards,
	callbacks,
}: {
	standards: ProfileStandard[];
	callbacks: RowCallbacks;
}) {
	return (
		<div className="flex flex-col gap-2">
			{standards.map((standard, index) => (
				<StandardRow
					callbacks={callbacks}
					isFirst={index === 0}
					isLast={index === standards.length - 1}
					key={standard.id}
					standard={standard}
				/>
			))}
		</div>
	);
}
