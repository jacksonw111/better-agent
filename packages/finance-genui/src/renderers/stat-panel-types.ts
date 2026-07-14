import type { ReactNode } from "react";
import type { StatGridItem } from "./primitives";

// StatPanel archetype (design doc §8.11): a grouped, no-time-axis metric
// snapshot. Shared type module so `stat-panel.tsx`/`stat-panel-group.tsx`
// and every port (key-metrics/company-profile/technical now, macro/
// sentiment next task) import the same shapes instead of redeclaring them.

/** A single StatPanel section: either a labeled `StatGrid` of stats
 * (`items`) or free-form `content` (RSI meter, a ProportionBar, paragraphs)
 * — the two are mutually exclusive, `items` wins if both are supplied.
 * Omit `label` for the lead group that sits flush under the header. */
export interface StatPanelGroup {
	/** `StatGrid` column count; defaults to `StatGrid`'s own default (3). */
	cols?: number;
	content?: ReactNode;
	items?: StatGridItem[];
	label?: string;
}

/** The single Expand (E) affordance: a labeled toggle that reveals
 * `content` — secondary groups, long-form paragraphs, whatever the tool's
 * payload carries but doesn't need always-visible. Callers omit this whole
 * prop (not just leave it undefined-shaped) when there's nothing extra, so
 * `StatPanel` renders no toggle at all. */
export interface StatPanelExpandable {
	content: ReactNode;
	label: string;
}

export interface StatPanelProps {
	expandable?: StatPanelExpandable;
	/** Always-visible groups, rendered top to bottom. */
	groups: StatPanelGroup[];
	right?: ReactNode;
	subtitle?: string;
	title: string;
}
