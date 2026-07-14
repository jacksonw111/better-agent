import { cn } from "@better-agent/ui/lib/utils";
import { ChevronDown } from "lucide-react";
import { motion } from "motion/react";
import type { ReactNode } from "react";
import { EASE_OUT, TRANSITION_MS, useReducedMotion } from "./motion";
import { CardShell } from "./primitives";
import { StatPanelGroupView } from "./stat-panel-group";
import type { StatPanelProps } from "./stat-panel-types";
import { useExpand } from "./use-expand";

// StatPanel archetype orchestrator (design doc §8.11, contract I·E): a
// `CardShell` header over always-visible `groups`, plus a single Expand (E)
// toggle that reveals secondary groups/long-form detail. No Sort/Filter —
// these payloads are single snapshots, not lists (unlike RankList/DataTable).
// Mirrors divergence-card.tsx's `StatDetailToggle`/`StatDetailPanel` pair,
// the one place in this codebase that already does a single-toggle Expand.

const CHEVRON_SIZE = 14;
const MS_PER_SECOND = 1000;
const EXPAND_FADE_SECONDS = TRANSITION_MS / MS_PER_SECOND;
/** `useExpand` is keyed by id for multi-row archetypes; StatPanel only ever
 * has the one toggle, so a constant id is enough. */
const PANEL_EXPAND_ID = "panel";

const TOGGLE_CLASS =
	"flex w-fit items-center gap-1 pt-1 text-muted-foreground text-xs transition-colors hover:text-foreground";

function ExpandToggle({
	expanded,
	label,
	onToggle,
}: {
	expanded: boolean;
	label: string;
	onToggle: () => void;
}) {
	return (
		<button
			aria-expanded={expanded}
			className={TOGGLE_CLASS}
			onClick={onToggle}
			type="button"
		>
			{expanded ? `收起${label}` : `展开${label}`}
			<ChevronDown
				className={cn("transition-transform", expanded && "rotate-180")}
				size={CHEVRON_SIZE}
			/>
		</button>
	);
}

/** Expand reveal: a plain opacity crossfade (§6 "行展开 crossfade"),
 * reduced-motion snaps instantly — same shape as rank-list-row.tsx's
 * `RowExpanded` and divergence-card.tsx's `StatDetailPanel`. */
function ExpandRegion({
	children,
	reduced,
}: {
	children: ReactNode;
	reduced: boolean;
}) {
	return (
		<motion.div
			animate={{ opacity: 1 }}
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

export function StatPanel({
	title,
	subtitle,
	right,
	groups,
	expandable,
}: StatPanelProps) {
	const reduced = useReducedMotion() ?? false;
	const expand = useExpand();
	const expanded = expand.isExpanded(PANEL_EXPAND_ID);

	return (
		<CardShell right={right} subtitle={subtitle} title={title}>
			{groups.map((group, index) => (
				// biome-ignore lint/suspicious/noArrayIndexKey: `groups` is a static, order-stable prop per render (never reordered/filtered by the caller), so index is a safe key here.
				<StatPanelGroupView group={group} key={index} />
			))}
			{expandable ? (
				<>
					<ExpandToggle
						expanded={expanded}
						label={expandable.label}
						onToggle={() => expand.toggle(PANEL_EXPAND_ID)}
					/>
					{expanded ? (
						<ExpandRegion reduced={reduced}>{expandable.content}</ExpandRegion>
					) : null}
				</>
			) : null}
		</CardShell>
	);
}
