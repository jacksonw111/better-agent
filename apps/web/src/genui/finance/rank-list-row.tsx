import { cn } from "@better-agent/ui/lib/utils";
import { motion } from "motion/react";
import type { ReactNode } from "react";
import { EASE_OUT, rowItemVariants, TRANSITION_MS } from "./motion";
import { ProportionBar, type ProportionBarTone } from "./proportion-bar";

// Phase 3 Task 5 — a single `RankList` row (design doc §8.6): rank badge +
// `renderPrimary` (entity name) on the header line, `renderSecondary` +
// an Expand chevron on the trailing edge, and the headline metric's
// `ProportionBar` (label + track + value) on the line beneath — "头部指标内嵌
// ProportionBar". Row hover lifts via tint (§8.6 "I 读 bar"); tap toggles
// Expand when the caller supplied `renderExpanded` (whole header line is the
// hit target, matching data-table-grid's row-click convention rather than a
// nested toggle button, so there's no button-inside-button a11y trap).

const RANK_WIDTH_CLASS =
	"w-6 shrink-0 text-right font-bold text-sm tabular-nums";
const CHEVRON_SIZE = 14;
const MS_PER_SECOND = 1000;
const EXPAND_FADE_SECONDS = TRANSITION_MS / MS_PER_SECOND;
/** Shared header-row layout for both the plain-`<div>` (not expandable) and
 * `<button>` (expandable) variants below, so the two branches stay visually
 * identical — only their interactivity differs. */
const HEADER_ROW_CLASS =
	"-mx-2 flex w-full items-center justify-between gap-2 rounded-md bg-transparent px-2 text-left transition-colors hover:bg-muted/40";

function resolveTone<T>(
	tone: ProportionBarTone | ((item: T) => ProportionBarTone) | undefined,
	item: T
): ProportionBarTone | undefined {
	return typeof tone === "function" ? tone(item) : tone;
}

/** Enter/Space activates a clickable row, matching its onClick (a11y parity
 * for the keyboard, mirrors data-table-grid.tsx's `activateOnKey`). */
function activateOnKey(
	event: { key: string; preventDefault: () => void },
	run: () => void
) {
	if (event.key === "Enter" || event.key === " ") {
		event.preventDefault();
		run();
	}
}

/** Decorative-only chevron — the whole header line is the click target, so
 * this is a plain rotating glyph rather than a second interactive control. */
function ExpandChevron({ expanded }: { expanded: boolean }) {
	return (
		<svg
			aria-hidden="true"
			className={cn(
				"shrink-0 text-muted-foreground transition-transform",
				expanded && "rotate-180"
			)}
			fill="none"
			height={CHEVRON_SIZE}
			stroke="currentColor"
			strokeLinecap="round"
			strokeLinejoin="round"
			strokeWidth={2}
			viewBox="0 0 24 24"
			width={CHEVRON_SIZE}
		>
			<path d="m6 9 6 6 6-6" />
		</svg>
	);
}

/** The rank badge + `renderPrimary`/`renderSecondary` slots shared by both
 * the plain-`<div>` and `<button>` header-row variants. */
function RowHeaderContent<T>({
	expandable,
	expanded,
	item,
	rank,
	renderPrimary,
	renderSecondary,
}: {
	expandable: boolean;
	expanded: boolean;
	item: T;
	rank: number;
	renderPrimary: (item: T) => ReactNode;
	renderSecondary?: (item: T) => ReactNode;
}) {
	return (
		<>
			<div className="flex min-w-0 items-center gap-2">
				<span className={RANK_WIDTH_CLASS}>{rank}</span>
				{renderPrimary(item)}
			</div>
			<div className="flex shrink-0 items-center gap-3">
				{renderSecondary?.(item)}
				{expandable ? <ExpandChevron expanded={expanded} /> : null}
			</div>
		</>
	);
}

/** Expand reveal: a plain opacity crossfade (§6 "行展开 crossfade"),
 * reduced-motion snaps instantly. */
function RowExpanded({
	children,
	reduced,
}: {
	children: ReactNode;
	reduced: boolean;
}) {
	return (
		<motion.div
			animate={{ opacity: 1 }}
			className="pt-1"
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

/** The header line's interactive shell — a `<button>` when the row can
 * Expand, a plain `<div>` otherwise. Split out from `RankListRow` to keep
 * that function under the file's line budget. */
function RowHeader<T>({
	expandable,
	expanded,
	item,
	onToggleExpand,
	rank,
	renderPrimary,
	renderSecondary,
}: {
	expandable: boolean;
	expanded: boolean;
	item: T;
	onToggleExpand: () => void;
	rank: number;
	renderPrimary: (item: T) => ReactNode;
	renderSecondary?: (item: T) => ReactNode;
}) {
	const content = (
		<RowHeaderContent
			expandable={expandable}
			expanded={expanded}
			item={item}
			rank={rank}
			renderPrimary={renderPrimary}
			renderSecondary={renderSecondary}
		/>
	);
	if (!expandable) {
		return <div className={HEADER_ROW_CLASS}>{content}</div>;
	}
	return (
		<button
			aria-expanded={expanded}
			className={cn(HEADER_ROW_CLASS, "cursor-pointer active:bg-muted/50")}
			onClick={onToggleExpand}
			onKeyDown={(event) => activateOnKey(event, onToggleExpand)}
			type="button"
		>
			{content}
		</button>
	);
}

interface RankListRowProps<T> {
	expanded: boolean;
	item: T;
	max: number;
	metricLabel: string;
	metricTone?: ProportionBarTone | ((item: T) => ProportionBarTone);
	metricValue?: (item: T) => ReactNode;
	onToggleExpand: () => void;
	rank: number;
	rankMetric: (item: T) => number | null;
	reduced: boolean;
	renderExpanded?: (item: T) => ReactNode;
	renderPrimary: (item: T) => ReactNode;
	renderSecondary?: (item: T) => ReactNode;
}

export function RankListRow<T>({
	expanded,
	item,
	max,
	metricLabel,
	metricTone,
	metricValue,
	onToggleExpand,
	rank,
	rankMetric,
	reduced,
	renderExpanded,
	renderPrimary,
	renderSecondary,
}: RankListRowProps<T>) {
	const expandable = renderExpanded !== undefined;
	const metric = rankMetric(item) ?? 0;

	return (
		<motion.div
			className="flex flex-col gap-1.5 py-2"
			variants={rowItemVariants(reduced)}
		>
			<RowHeader
				expandable={expandable}
				expanded={expanded}
				item={item}
				onToggleExpand={onToggleExpand}
				rank={rank}
				renderPrimary={renderPrimary}
				renderSecondary={renderSecondary}
			/>
			<ProportionBar
				label={metricLabel}
				max={max}
				tone={resolveTone(metricTone, item)}
				value={metric}
				valueLabel={metricValue?.(item)}
			/>
			{expandable && expanded ? (
				<RowExpanded reduced={reduced}>{renderExpanded?.(item)}</RowExpanded>
			) : null}
		</motion.div>
	);
}
