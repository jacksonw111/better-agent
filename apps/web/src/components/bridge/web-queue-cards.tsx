import { Button } from "@better-agent/ui/components/button";
import { PencilIcon, XIcon } from "lucide-react";
import type { WebQueueItem } from "./use-web-queue";

// P2-T5: the web-side busy queue's cards, stacked directly above the
// composer. Deliberately borderless (tint + radius only, per the workspace's
// tool-rendering language) and clearly labeled "待发送" so they can't be
// confused with pi's agent-side "已排队 N 条" chip (busy-input-hint.tsx).

interface WebQueueCardProps {
	item: WebQueueItem;
	/** Loads the card's text back into the composer AND removes the card —
	 * the "edit" affordance (simpler than an inline editor, and the composer
	 * already has full editing). */
	onEdit: (item: WebQueueItem) => void;
	onRemove: (id: string) => void;
}

function WebQueueCard({ item, onEdit, onRemove }: WebQueueCardProps) {
	return (
		<li className="flex items-center gap-2 rounded-lg bg-muted/60 py-1 pr-1 pl-2.5">
			<p className="line-clamp-2 min-w-0 flex-1 whitespace-pre-wrap break-words text-sm">
				{item.text}
			</p>
			<Button
				aria-label="编辑待发送消息"
				className="shrink-0 text-muted-foreground"
				onClick={() => onEdit(item)}
				size="icon-sm"
				title="编辑（载回输入框）"
				type="button"
				variant="ghost"
			>
				<PencilIcon className="size-3.5" />
			</Button>
			<Button
				aria-label="删除待发送消息"
				className="shrink-0 text-muted-foreground"
				onClick={() => onRemove(item.id)}
				size="icon-sm"
				title="删除"
				type="button"
				variant="ghost"
			>
				<XIcon className="size-3.5" />
			</Button>
		</li>
	);
}

export interface WebQueueCardsProps {
	items: WebQueueItem[];
	onEdit: (item: WebQueueItem) => void;
	onRemove: (id: string) => void;
}

/** The stack of pending ("待发送") cards — renders nothing while the queue is
 * empty. Items flush FIFO on the busy→idle transition (see use-web-queue.ts);
 * until then each card can be deleted or loaded back into the composer. */
export function WebQueueCards({ items, onEdit, onRemove }: WebQueueCardsProps) {
	if (items.length === 0) {
		return null;
	}
	return (
		<div className="mb-1.5 px-1">
			<p className="mb-1 text-muted-foreground text-xs">
				待发送 {items.length} 条 — 本回合结束后自动发出
			</p>
			<ul className="flex flex-col gap-1">
				{items.map((item) => (
					<WebQueueCard
						item={item}
						key={item.id}
						onEdit={onEdit}
						onRemove={onRemove}
					/>
				))}
			</ul>
		</div>
	);
}
