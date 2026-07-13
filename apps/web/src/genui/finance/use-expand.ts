import { useState } from "react";

/**
 * Phase 0 Task D — `useExpand` interaction hook (design doc §3 "Expand").
 * Row/tile inline expansion for DataTable/RankList archetypes.
 */

export type ExpandMode = "single" | "multi";

/** Independent expansion by default; pass "single" for an accordion. */
const DEFAULT_EXPAND_MODE: ExpandMode = "multi";

interface UseExpandOptions {
	mode?: ExpandMode;
}

interface UseExpandResult {
	collapseAll: () => void;
	expandedIds: string[];
	isExpanded: (id: string) => boolean;
	toggle: (id: string) => void;
}

/** `single` = accordion (opening one closes others); `multi` = independent. */
export function useExpand(opts: UseExpandOptions = {}): UseExpandResult {
	const mode = opts.mode ?? DEFAULT_EXPAND_MODE;
	const [expandedIds, setExpandedIds] = useState<string[]>([]);

	const toggle = (id: string) => {
		setExpandedIds((prev) => {
			const isOpen = prev.includes(id);
			if (mode === "single") {
				return isOpen ? [] : [id];
			}
			return isOpen
				? prev.filter((existing) => existing !== id)
				: [...prev, id];
		});
	};

	const isExpanded = (id: string) => expandedIds.includes(id);
	const collapseAll = () => setExpandedIds([]);

	return { expandedIds, toggle, isExpanded, collapseAll };
}
