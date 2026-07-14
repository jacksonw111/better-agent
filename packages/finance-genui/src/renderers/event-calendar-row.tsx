import { ChevronDown } from "lucide-react";
import { motion } from "motion/react";
import type { ReactNode } from "react";
import { cn } from "../lib/cn";
import type { CalendarEvent } from "./event-calendar-types";
import { EASE_OUT, rowItemVariants, TRANSITION_MS } from "./motion";

// Phase 3 Task 4 — a single `Calendar` event row (design doc §8.9). The whole
// row is the tap target when the event has a detail to reveal (mirrors
// NewsFeed's `FeedRow`, but the toggle spans the full row rather than a
// trailing icon button alone — calendar rows carry no outbound link to
// compete for the tap).

const CHEVRON_SIZE = 14;
const MS_PER_SECOND = 1000;
const EXPAND_FADE_SECONDS = TRANSITION_MS / MS_PER_SECOND;

/** Detail reveal: a plain opacity crossfade (§6 "行展开 crossfade"),
 * reduced-motion snaps instantly. */
function EventDetail({
	children,
	reduced,
}: {
	children: ReactNode;
	reduced: boolean;
}) {
	return (
		<motion.div
			animate={{ opacity: 1 }}
			className="flex flex-col gap-1 pt-0.5 text-xs"
			initial={reduced ? false : { opacity: 0 }}
			transition={
				reduced
					? { duration: 0 }
					: { duration: EXPAND_FADE_SECONDS, ease: EASE_OUT }
			}
		>
			{children}
		</motion.div>
	);
}

function RowHeader<T>({
	event,
	expandable,
	expanded,
	onToggleExpand,
	renderEvent,
}: {
	event: CalendarEvent<T>;
	expandable: boolean;
	expanded: boolean;
	onToggleExpand: () => void;
	renderEvent: (raw: T) => ReactNode;
}) {
	const content = (
		<div className="min-w-0 flex-1">{renderEvent(event.raw)}</div>
	);
	if (!expandable) {
		return <div className="flex items-start gap-2">{content}</div>;
	}
	return (
		<button
			aria-expanded={expanded}
			aria-label={expanded ? "收起详情" : "展开详情"}
			className="flex w-full items-start gap-2 rounded-md text-left transition-colors hover:bg-muted/30 active:scale-95"
			onClick={onToggleExpand}
			type="button"
		>
			{content}
			<ChevronDown
				className={cn(
					"mt-1 shrink-0 text-muted-foreground transition-transform",
					expanded && "rotate-180"
				)}
				size={CHEVRON_SIZE}
			/>
		</button>
	);
}

export function EventCalendarRow<T>({
	event,
	expanded,
	onToggleExpand,
	reduced,
	renderEvent,
	renderExpanded,
}: {
	event: CalendarEvent<T>;
	expanded: boolean;
	onToggleExpand: () => void;
	reduced: boolean;
	renderEvent: (raw: T) => ReactNode;
	renderExpanded?: (raw: T) => ReactNode;
}) {
	// Evaluated once per render (not per click) so an item that genuinely has
	// nothing more to show — e.g. central-bank rows whose row already
	// surfaces every field — gets no Expand affordance at all, mirroring
	// NewsFeed's `Boolean(item.snippet)` per-item rule rather than treating
	// `renderExpanded`'s mere presence as "this item is expandable".
	const detail = renderExpanded?.(event.raw) ?? null;
	const expandable = detail !== null;
	return (
		<motion.div
			className="flex flex-col gap-0.5 rounded-md px-2 py-1.5"
			variants={rowItemVariants(reduced)}
		>
			<RowHeader
				event={event}
				expandable={expandable}
				expanded={expanded}
				onToggleExpand={onToggleExpand}
				renderEvent={renderEvent}
			/>
			{expandable && expanded ? (
				<EventDetail reduced={reduced}>{detail}</EventDetail>
			) : null}
		</motion.div>
	);
}
