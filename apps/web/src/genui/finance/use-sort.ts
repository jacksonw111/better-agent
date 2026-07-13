import { useMemo, useState } from "react";

/**
 * Phase 0 Task D — `useSort` interaction hook (design doc §3 "Sort").
 *
 * Pure client-side sort over an already-returned tool payload. Never
 * mutates `rows`; never triggers a new tool call.
 */

export type SortDirection = "asc" | "desc";

/** Finance default: clicking a new column shows the biggest values first. */
const DEFAULT_SORT_DIRECTION: SortDirection = "desc";

interface UseSortOptions<T> {
	/** Per-key value accessors for columns whose sortable value isn't a raw
	 * `row[key]` field — e.g. a derived/metric column with `value: (row) =>
	 * row.bar` under `key: "foo"`. When the active `sortKey` has an entry
	 * here, `accessor(row)` is compared instead of `row[key]`; keys without
	 * an accessor fall back to the existing `row[key]` behavior unchanged. */
	accessors?: Partial<Record<keyof T, (row: T) => number | string | null>>;
	initialDir?: SortDirection;
	initialKey?: keyof T;
}

interface UseSortResult<T> {
	sortDir: SortDirection;
	sorted: T[];
	sortKey: keyof T | undefined;
	toggleSort: (key: keyof T) => void;
}

function isMissing(value: unknown): boolean {
	if (value === null || value === undefined) {
		return true;
	}
	return typeof value === "number" && Number.isNaN(value);
}

function compareValues(a: unknown, b: unknown, dir: SortDirection): number {
	const aMissing = isMissing(a);
	const bMissing = isMissing(b);
	if (aMissing && bMissing) {
		return 0;
	}
	// null/undefined/NaN always sort last, regardless of direction.
	if (aMissing) {
		return 1;
	}
	if (bMissing) {
		return -1;
	}

	const sign = dir === "asc" ? 1 : -1;
	if (typeof a === "number" && typeof b === "number") {
		return (a - b) * sign;
	}
	const aStr = String(a);
	const bStr = String(b);
	if (aStr === bStr) {
		return 0;
	}
	return (aStr < bStr ? -1 : 1) * sign;
}

/** Stable sort over `rows` by a toggleable column key. */
export function useSort<T>(
	rows: readonly T[],
	opts: UseSortOptions<T> = {}
): UseSortResult<T> {
	const [sortKey, setSortKey] = useState<keyof T | undefined>(opts.initialKey);
	const [sortDir, setSortDir] = useState<SortDirection>(
		opts.initialDir ?? DEFAULT_SORT_DIRECTION
	);

	const sorted = useMemo(() => {
		if (sortKey === undefined) {
			return [...rows];
		}
		const accessor = opts.accessors?.[sortKey];
		const getValue = accessor ? accessor : (row: T) => row[sortKey];
		// `Array.prototype.sort` is spec-guaranteed stable (ES2019+).
		return [...rows].sort((a, b) =>
			compareValues(getValue(a), getValue(b), sortDir)
		);
	}, [rows, sortKey, sortDir, opts.accessors]);

	const toggleSort = (key: keyof T) => {
		if (key === sortKey) {
			setSortDir((prev) => (prev === "asc" ? "desc" : "asc"));
			return;
		}
		setSortKey(key);
		setSortDir(DEFAULT_SORT_DIRECTION);
	};

	return { sorted, sortKey, sortDir, toggleSort };
}
