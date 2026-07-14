import { motion } from "motion/react";
import { cn } from "../lib/cn";
import { changeColor, formatNum } from "./format";
import { EASE_OUT, rowItemVariants, TRANSITION_MS } from "./motion";
import { ChangePct, StatGrid, type StatGridItem } from "./primitives";

// Press-feedback scale (§6 "按压反馈") shares the `active:scale-[0.98]` token
// used by chip.tsx/segmented.tsx — kept on its own `cn()` line to match their
// existing formatting.
const TILE_CLASS = cn(
	"flex flex-col gap-1 rounded-md bg-muted/40 p-3 text-left transition-colors hover:bg-muted/60",
	"active:scale-[0.98]"
);

// QuoteGrid tile (design doc §8.8 QuoteGrid, So·E·I). One tile per instrument:
// name + last price (price-axis colored) + ChangePct, tap to expand extra
// fields inline. Shared by index-grid.tsx and commodity-grid.tsx via
// `QuoteTileData` — each caller maps its own schema into this shape.

export interface QuoteTileData {
	changePct: number | null;
	/** Optional small muted tag next to the name, e.g. region. */
	expandItems: StatGridItem[];
	id: string;
	last: number | null;
	meta?: string;
	name: string;
}

const MS_PER_SECOND = 1000;
const EXPAND_FADE_SECONDS = TRANSITION_MS / MS_PER_SECOND;

/** Extra fields shown on expand — a plain opacity crossfade (§6 "行展开
 * crossfade"), reduced-motion snaps instantly. */
function ExpandPanel({
	items,
	reduced,
}: {
	items: StatGridItem[];
	reduced: boolean;
}) {
	return (
		<motion.div
			animate={{ opacity: 1 }}
			className="mt-1 pt-1"
			initial={reduced ? false : { opacity: 0 }}
			transition={
				reduced
					? { duration: 0 }
					: { duration: EXPAND_FADE_SECONDS, ease: EASE_OUT }
			}
		>
			<StatGrid cols={2} items={items} />
		</motion.div>
	);
}

/** One quote tile. A native `<button>` gives keyboard activation (Enter/
 * Space) for free instead of hand-rolled `onKeyDown` wiring. */
export function QuoteTile({
	expanded,
	item,
	onToggle,
	reduced,
}: {
	expanded: boolean;
	item: QuoteTileData;
	onToggle: () => void;
	reduced: boolean;
}) {
	const priceColor = changeColor(item.changePct);
	return (
		<motion.button
			aria-expanded={expanded}
			className={TILE_CLASS}
			onClick={onToggle}
			type="button"
			variants={rowItemVariants(reduced)}
		>
			<div className="flex items-baseline justify-between gap-2">
				<span className="truncate font-medium text-sm">{item.name}</span>
				{item.meta ? (
					<span className="shrink-0 text-muted-foreground text-xs">
						{item.meta}
					</span>
				) : null}
			</div>
			<span
				className="font-semibold text-lg tabular-nums"
				style={priceColor ? { color: priceColor } : undefined}
			>
				{formatNum(item.last)}
			</span>
			<ChangePct value={item.changePct} />
			{expanded ? (
				<ExpandPanel items={item.expandItems} reduced={reduced} />
			) : null}
		</motion.button>
	);
}
