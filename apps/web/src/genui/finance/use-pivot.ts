import { useState } from "react";

/**
 * Phase 0 Task D — `usePivot` interaction hook (design doc §3 "Pivot").
 * Table ⇄ chart view swap for the same underlying data.
 */

export type PivotView = "table" | "chart";

const DEFAULT_PIVOT_VIEW: PivotView = "table";

interface UsePivotOptions {
	initial?: PivotView;
}

interface UsePivotResult {
	setView: (view: PivotView) => void;
	toggle: () => void;
	view: PivotView;
}

/** Two-state table/chart view swap. */
export function usePivot(opts: UsePivotOptions = {}): UsePivotResult {
	const [view, setView] = useState<PivotView>(
		opts.initial ?? DEFAULT_PIVOT_VIEW
	);

	const toggle = () =>
		setView((prev) => (prev === "table" ? "chart" : "table"));

	return { view, setView, toggle };
}
