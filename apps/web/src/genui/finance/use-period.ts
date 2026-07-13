import { useMemo, useState } from "react";

/**
 * Phase 0 Task D — `usePeriod` interaction hook (design doc §3 "Period").
 * Segmented period/range control (年/季, or 30/90/1Y).
 *
 * The hook only carries availability so a component can grey out periods
 * that exceed what the payload contains (spec §3: "超出 payload 置灰"). It
 * never fetches more data — that is an explicit out-of-scope backlog item.
 */

const ALL_PERIODS_AVAILABLE = () => true;

interface UsePeriodOptions<P> {
	initial?: P;
	isAvailable?: (period: P) => boolean;
}

interface UsePeriodResult<P> {
	isAvailable: (period: P) => boolean;
	period: P;
	periods: P[];
	setPeriod: (period: P) => void;
}

/** Segmented period/range selection over a fixed, caller-supplied list. */
export function usePeriod<P>(
	periods: readonly P[],
	opts: UsePeriodOptions<P> = {}
): UsePeriodResult<P> {
	const [period, setPeriod] = useState<P>(() => {
		if (opts.initial !== undefined) {
			return opts.initial;
		}
		if (periods.length === 0) {
			throw new Error("usePeriod requires at least one period");
		}
		return periods[0];
	});

	const periodsCopy = useMemo(() => [...periods], [periods]);
	const isAvailable = opts.isAvailable ?? ALL_PERIODS_AVAILABLE;

	return { period, setPeriod, periods: periodsCopy, isAvailable };
}
