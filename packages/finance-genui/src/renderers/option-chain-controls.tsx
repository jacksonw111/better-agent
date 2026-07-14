import { ControlStrip } from "./control-strip";
import { Segmented, type SegmentedOption } from "./segmented";

// LadderTable F/So controls (design doc §8.5 "F·So·I·E"). F (Filter, which
// wing to show) is the ControlStrip's primary (left) Segmented, matching §3's
// default. So (Sort) has no table header row to live in on this mirrored
// center-axis board — like NewsFeed (which also has no header row it can host
// Sort in), it's placed as a small Segmented in the ControlStrip's right
// (chips) slot instead. This is the LadderTable's accepted §3 addendum. No
// "平值附近" (near-ATM) filter: it needs the underlying spot price, which
// `OptionRowData` doesn't carry (never invent a data dimension).

export type ChainFilter = "all" | "call" | "put";
export type ChainSort = "strike" | "volume";

const FILTER_OPTIONS: SegmentedOption[] = [
	{ id: "all", label: "全部" },
	{ id: "call", label: "仅认购" },
	{ id: "put", label: "仅认沽" },
];

const SORT_OPTIONS: SegmentedOption[] = [
	{ id: "strike", label: "行权价升序" },
	{ id: "volume", label: "成交量" },
];

export function OptionChainControls({
	filter,
	onFilterChange,
	onSortChange,
	sort,
}: {
	filter: ChainFilter;
	onFilterChange: (id: ChainFilter) => void;
	onSortChange: (id: ChainSort) => void;
	sort: ChainSort;
}) {
	return (
		<ControlStrip
			chips={
				<Segmented
					onChange={(id) => onSortChange(id as ChainSort)}
					options={SORT_OPTIONS}
					value={sort}
				/>
			}
			primary={
				<Segmented
					onChange={(id) => onFilterChange(id as ChainFilter)}
					options={FILTER_OPTIONS}
					value={filter}
				/>
			}
		/>
	);
}
