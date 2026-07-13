import { MAX_RENDERED_ITEMS } from "../tool-renderers";
import type { EtfRowData } from "./finance-schemas-fe14";
import { formatCompact, formatNum } from "./format";
import { ChangePct } from "./primitives";
import { RankList, RankListMoreFooter } from "./rank-list";
import type { RankListSortOption } from "./rank-list-types";

// finance_etf_list → A股 ETF 列表, ported onto the `RankList` archetype
// (design doc §8.6, contract So·F·E·I). `EtfRowData` carries no AUM/规模
// field, so the headline metric is 成交额 (turnover) — the closest proxy for
// "how much capital is moving through this ETF right now" that the payload
// actually has. Tone is fixed "probability": turnover is a magnitude, not
// itself a price move, so it stays off the price axis (§5.2 axis purity).
// Filter is omitted: the schema carries no discrete category field to filter
// by (never invent one).

const SORT_OPTIONS: RankListSortOption<EtfRowData>[] = [
	{ accessor: (row) => row.changePct, id: "changePct", label: "涨跌幅" },
];

function EtfPrimary({ item }: { item: EtfRowData }) {
	return (
		<div className="flex min-w-0 flex-col">
			<span className="truncate font-medium text-sm">
				{item.name || item.code}
			</span>
			<span className="truncate text-muted-foreground text-xs">
				{item.code}
			</span>
		</div>
	);
}

function EtfSecondary({ item }: { item: EtfRowData }) {
	return (
		<>
			<span className="text-sm tabular-nums">{formatNum(item.price)}</span>
			<ChangePct value={item.changePct} />
		</>
	);
}

/** finance_etf_list → A股 ETF 列表, ranked by change% (the tool already
 * returns rows in that order), capped at MAX_RENDERED_ITEMS. */
export function EtfList({ data }: { data: EtfRowData[] }) {
	if (data.length === 0) {
		return null;
	}
	const visible = data.slice(0, MAX_RENDERED_ITEMS);
	const hiddenCount = data.length - visible.length;

	return (
		<RankList
			footer={
				hiddenCount > 0 ? <RankListMoreFooter count={hiddenCount} /> : null
			}
			getRowKey={(item, index) => `${item.code}-${index}`}
			items={visible}
			metricLabel="成交额"
			metricTone="probability"
			metricValue={(item) => formatCompact(item.turnover, { cny: true })}
			rankMetric={(item) => item.turnover}
			renderPrimary={(item) => <EtfPrimary item={item} />}
			renderSecondary={(item) => <EtfSecondary item={item} />}
			sortOptions={SORT_OPTIONS}
			title="ETF"
		/>
	);
}
