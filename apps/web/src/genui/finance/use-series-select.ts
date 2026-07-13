import { useState } from "react";

/**
 * Phase 0 Task D — `useSeriesSelect` interaction hook (design doc §3
 * "Series"). Metric chips, e.g. statements 营收/净利/毛利率.
 *
 * Pure client-side selection over an already-known id list. Never triggers
 * a new tool call.
 */

/** A chart must never go empty by deselecting its last metric. */
const DEFAULT_MIN_SELECTED = 1;

interface UseSeriesSelectOptions {
	initial?: string[];
	max?: number;
	min?: number;
}

interface UseSeriesSelectResult {
	isSelected: (id: string) => boolean;
	selected: string[];
	setSelected: (ids: string[]) => void;
	toggle: (id: string) => void;
}

function dedupeOrdered(ids: string[]): string[] {
	const seen = new Set<string>();
	const result: string[] = [];
	for (const id of ids) {
		if (!seen.has(id)) {
			seen.add(id);
			result.push(id);
		}
	}
	return result;
}

/** Order-stable metric-chip selection with a min floor and optional cap. */
export function useSeriesSelect(
	allIds: readonly string[],
	opts: UseSeriesSelectOptions = {}
): UseSeriesSelectResult {
	const min = opts.min ?? DEFAULT_MIN_SELECTED;
	const [selected, setSelectedState] = useState<string[]>(
		() => opts.initial ?? allIds.slice(0, min)
	);

	const setSelected = (ids: string[]) => {
		const next = dedupeOrdered(ids.filter((id) => allIds.includes(id)));
		if (next.length < min) {
			return;
		}
		if (opts.max !== undefined && next.length > opts.max) {
			return;
		}
		setSelectedState(next);
	};

	const toggle = (id: string) => {
		if (selected.includes(id)) {
			if (selected.length <= min) {
				return;
			}
			setSelectedState(selected.filter((existing) => existing !== id));
			return;
		}
		if (opts.max !== undefined && selected.length >= opts.max) {
			return;
		}
		setSelectedState([...selected, id]);
	};

	const isSelected = (id: string) => selected.includes(id);

	return { selected, toggle, isSelected, setSelected };
}
