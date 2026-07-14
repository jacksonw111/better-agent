import { useMemo, useState } from "react";

/**
 * Phase 0 Task D — `useFilter` interaction hook (design doc §3 "Filter").
 *
 * Covers both interaction shapes called out in the spec:
 * - single-select segmented (dragon_tiger 买/卖, option calls/puts) — one
 *   active option at a time, plus an implicit "all" default.
 * - multi-toggle (money_flow 超大/大/中/小单 series on/off) — an independent
 *   set of active option ids.
 *
 * Pure client-side filtering over an already-returned tool payload. Never
 * mutates `rows`; never triggers a new tool call.
 */

export type FilterMode = "single" | "multi";

export interface FilterOption<T> {
	id: string;
	predicate: (row: T) => boolean;
}

interface UseFilterOptions {
	initial?: string | string[];
	mode?: FilterMode;
}

export interface UseFilterResult<T> {
	activeIds: string[];
	clear: () => void;
	filtered: T[];
	isActive: (id: string) => boolean;
	setActive: (id: string) => void;
	toggle: (id: string) => void;
}

const DEFAULT_FILTER_MODE: FilterMode = "single";

function normalizeInitial(initial: string | string[] | undefined): string[] {
	if (initial === undefined) {
		return [];
	}
	return Array.isArray(initial) ? [...initial] : [initial];
}

/**
 * Client-side row/series filter. With no active option (either mode), all
 * rows pass through — matching the single-select "all" default and keeping
 * multi-mode's empty state predictable.
 */
export function useFilter<T>(
	rows: readonly T[],
	options: readonly FilterOption<T>[],
	opts: UseFilterOptions = {}
): UseFilterResult<T> {
	const mode = opts.mode ?? DEFAULT_FILTER_MODE;
	const [activeIds, setActiveIds] = useState<string[]>(() =>
		normalizeInitial(opts.initial)
	);

	const filtered = useMemo(() => {
		if (activeIds.length === 0) {
			return [...rows];
		}
		const activePredicates = options
			.filter((option) => activeIds.includes(option.id))
			.map((option) => option.predicate);
		if (activePredicates.length === 0) {
			return [...rows];
		}
		return rows.filter((row) =>
			activePredicates.some((predicate) => predicate(row))
		);
	}, [rows, options, activeIds]);

	const toggle = (id: string) => {
		if (mode === "single") {
			setActiveIds((prev) => (prev[0] === id ? [] : [id]));
			return;
		}
		setActiveIds((prev) =>
			prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
		);
	};

	const setActive = (id: string) => setActiveIds([id]);
	const isActive = (id: string) => activeIds.includes(id);
	const clear = () => setActiveIds([]);

	return { filtered, activeIds, toggle, setActive, isActive, clear };
}
