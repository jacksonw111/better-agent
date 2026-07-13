import { Badge } from "@better-agent/ui/components/badge";
import { cn } from "@better-agent/ui/lib/utils";
import { ChevronDown } from "lucide-react";
import { motion } from "motion/react";
import { formatDate } from "./format";
import { EASE_OUT, rowItemVariants, TRANSITION_MS } from "./motion";
import type { FeedItem } from "./news-feed-types";

// Phase 3 Task 3 — a single `NewsFeed` row (design doc §8.10). Header line =
// title (a link when `url` is present) + Expand toggle (only when `snippet`
// is present); meta line = time · source; optional neutral `badge`; optional
// always-visible `meta` content (e.g. `PdfLink`, an EPS/PE grid).

const CHEVRON_SIZE = 14;
const MS_PER_SECOND = 1000;
const EXPAND_FADE_SECONDS = TRANSITION_MS / MS_PER_SECOND;

const TITLE_LINK_CLASS =
	"font-medium text-sm hover:underline focus-visible:underline";

function FeedItemTitle({ item }: { item: FeedItem }) {
	if (item.url) {
		return (
			<a
				className={TITLE_LINK_CLASS}
				href={item.url}
				rel="noopener noreferrer"
				target="_blank"
			>
				{item.title || "—"}
			</a>
		);
	}
	return <span className="font-medium text-sm">{item.title || "—"}</span>;
}

function FeedItemMetaLine({ item }: { item: FeedItem }) {
	const timeLabel = formatDate(item.time);
	return (
		<span className="text-muted-foreground text-xs">
			{item.source ? `${timeLabel} · ${item.source}` : timeLabel}
		</span>
	);
}

/** Icon-only toggle — `aria-label` supplies the accessible name since the
 * chevron alone carries no discernible text. */
function ExpandToggle({
	expanded,
	onToggle,
}: {
	expanded: boolean;
	onToggle: () => void;
}) {
	return (
		<button
			aria-expanded={expanded}
			aria-label={expanded ? "收起摘要" : "展开摘要"}
			className="flex shrink-0 items-center justify-center rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground active:scale-95"
			onClick={onToggle}
			type="button"
		>
			<ChevronDown
				className={cn("transition-transform", expanded && "rotate-180")}
				size={CHEVRON_SIZE}
			/>
		</button>
	);
}

/** Snippet reveal: a plain opacity crossfade (§6 "行展开 crossfade"),
 * reduced-motion snaps instantly. */
function FeedSnippet({
	reduced,
	snippet,
}: {
	reduced: boolean;
	snippet: string;
}) {
	return (
		<motion.p
			animate={{ opacity: 1 }}
			className="text-muted-foreground text-xs"
			initial={reduced ? false : { opacity: 0 }}
			transition={
				reduced
					? { duration: 0 }
					: { duration: EXPAND_FADE_SECONDS, ease: EASE_OUT }
			}
		>
			{snippet}
		</motion.p>
	);
}

export function FeedRow({
	expanded,
	item,
	onToggleExpand,
	reduced,
}: {
	expanded: boolean;
	item: FeedItem;
	onToggleExpand: () => void;
	reduced: boolean;
}) {
	const expandable = Boolean(item.snippet);
	return (
		<motion.div
			className="flex flex-col gap-1 pb-2 last:pb-0"
			variants={rowItemVariants(reduced)}
		>
			<div className="flex items-start justify-between gap-2">
				<div className="flex min-w-0 flex-col gap-0.5">
					<FeedItemTitle item={item} />
					<FeedItemMetaLine item={item} />
				</div>
				<div className="flex shrink-0 items-center gap-1.5">
					{item.badge ? <Badge variant="outline">{item.badge}</Badge> : null}
					{expandable ? (
						<ExpandToggle expanded={expanded} onToggle={onToggleExpand} />
					) : null}
				</div>
			</div>
			{expandable && expanded && item.snippet ? (
				<FeedSnippet reduced={reduced} snippet={item.snippet} />
			) : null}
			{item.meta}
		</motion.div>
	);
}
