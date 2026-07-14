import { useMemo, useState } from "react";
import type { OptionRowData } from "./finance-schemas-fe14";
import { useReducedMotion } from "./motion";
import { OptionChainBoard } from "./option-chain-board";
import {
	type ChainFilter,
	type ChainSort,
	OptionChainControls,
} from "./option-chain-controls";
import type { StrikeRow } from "./option-chain-types";
import { groupByStrike, MAX_STRIKES, strikeVolume } from "./option-chain-types";
import { CardShell } from "./primitives";
import { useExpand } from "./use-expand";

// finance_option_chain → ETF 期权链 T 型报价板, the LadderTable archetype
// (design doc §8.5): mirrored Calls (left) | 行权价 (center axis) | Puts
// (right), rows keyed by strike ascending by default. Interactive F (which
// wing to show) / So (strike vs 成交量 order) / E (expand both legs at a
// strike). Single consumer of the LadderTable skeleton — kept concrete, not
// generalized into `LadderTable<T>` (see option-chain-types.ts's module
// comment). This file is the thin orchestrator: F/So/E state + the derived
// visible strike rows; the mirrored table body lives in
// option-chain-board.tsx, the ControlStrip in option-chain-controls.tsx.

function sortStrikes(rows: StrikeRow[], sort: ChainSort): StrikeRow[] {
	if (sort === "strike") {
		return rows;
	}
	return [...rows].sort((a, b) => strikeVolume(b) - strikeVolume(a));
}

/** finance_option_chain → ETF 期权链 T 型报价板: rows keyed by strike price,
 * with the 认购 (call) leg on the left and 认沽 (put) leg on the right of the
 * 行权价 column, capped at MAX_STRIKES strikes. A missing leg (no call or no
 * put quoted at a given strike) renders as "—". */
export function OptionChain({ data }: { data: OptionRowData[] }) {
	const [filter, setFilter] = useState<ChainFilter>("all");
	const [sort, setSort] = useState<ChainSort>("strike");
	const reduced = useReducedMotion() ?? false;
	const expand = useExpand();

	const strikeRows = useMemo(() => groupByStrike(data), [data]);
	const ordered = useMemo(
		() => sortStrikes(strikeRows, sort),
		[strikeRows, sort]
	);

	if (strikeRows.length === 0) {
		return null;
	}

	const visible = ordered.slice(0, MAX_STRIKES);
	const hiddenCount = ordered.length - visible.length;

	return (
		<CardShell title="期权链">
			<OptionChainControls
				filter={filter}
				onFilterChange={setFilter}
				onSortChange={setSort}
				sort={sort}
			/>
			<OptionChainBoard
				filter={filter}
				isExpanded={expand.isExpanded}
				onToggleExpand={expand.toggle}
				reduced={reduced}
				rows={visible}
			/>
			{hiddenCount > 0 ? (
				<p className="text-muted-foreground text-xs">+{hiddenCount} more</p>
			) : null}
		</CardShell>
	);
}
