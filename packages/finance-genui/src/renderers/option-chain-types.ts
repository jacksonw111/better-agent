import type { OptionRowData } from "./finance-schemas-fe14";

// LadderTable archetype (design doc §8.5) — finance_option_chain is the only
// consumer of this T-board skeleton, so it stays a concrete implementation
// rather than a generalized `LadderTable<T>` primitive (YAGNI; a reviewer
// would flag speculative generality introduced for a single tool).

export const MAX_STRIKES = 20;

export interface StrikeRow {
	call?: OptionRowData;
	put?: OptionRowData;
	strike: number;
}

/** Groups option rows by strike price: for each strike, at most one call leg
 * and one put leg. Rows without a strike can't be placed on the T-board and
 * are dropped. Sorted ascending by strike (the LadderTable's default 行权价
 * order — So's alternative "成交量" sort is applied by the caller on top of
 * this). */
export function groupByStrike(data: OptionRowData[]): StrikeRow[] {
	const byStrike = new Map<number, StrikeRow>();
	for (const row of data) {
		if (row.strike === null) {
			continue;
		}
		const existing = byStrike.get(row.strike) ?? { strike: row.strike };
		if (row.kind === "call") {
			existing.call = row;
		} else {
			existing.put = row;
		}
		byStrike.set(row.strike, existing);
	}
	return [...byStrike.values()].sort((a, b) => a.strike - b.strike);
}

/** Total volume across both legs at a strike (a missing leg counts as 0) —
 * the "成交量" (活跃度) So accessor: strikes with the most combined trading
 * surface surface first. */
export function strikeVolume(row: StrikeRow): number {
	return (row.call?.volume ?? 0) + (row.put?.volume ?? 0);
}
