import { MAX_RENDERED_ITEMS } from "../tool-renderers";
import type { IndexWeightRowData } from "./finance-schemas-fe14";
import { formatNum, formatRatio } from "./format";
import { ChangePct, StatGrid } from "./primitives";
import { RankList, RankListMoreFooter } from "./rank-list";
import type { RankListSortOption } from "./rank-list-types";

// finance_index_weights → 指数成分权重, ported onto the `RankList` archetype
// (design doc §8.6/§9 "旧的柱状图改成榜单" ⚠): headline metric = 权重
// (ProportionBar, "neutral" tone — a static composition figure, not a signed
// price move, same reasoning as the recharts BAR_COLOR indigo accent this
// replaces, §5.2 axis purity). 行业/PE/ROE move into the row's Expand
// region rather than crowding the header.

const SORT_OPTIONS: RankListSortOption<IndexWeightRowData>[] = [
	{ accessor: (row) => row.changePct, id: "changePct", label: "涨跌幅" },
];

function WeightPrimary({ item }: { item: IndexWeightRowData }) {
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

function WeightSecondary({ item }: { item: IndexWeightRowData }) {
	return (
		<>
			<span className="text-sm tabular-nums">{formatNum(item.closePrice)}</span>
			<ChangePct value={item.changePct} />
		</>
	);
}

function WeightExpanded({ item }: { item: IndexWeightRowData }) {
	return (
		<StatGrid
			cols={3}
			items={[
				{ label: "行业", value: item.industry || "—" },
				{ label: "PE", value: formatNum(item.pe) },
				{ label: "ROE", value: formatRatio(item.roe) },
			]}
		/>
	);
}

/** finance_index_weights → 指数成分权重, ranked by weight (the tool already
 * returns rows in that order), capped at MAX_RENDERED_ITEMS. */
export function IndexWeights({ data }: { data: IndexWeightRowData[] }) {
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
			metricLabel="权重"
			metricTone="neutral"
			metricValue={(item) => formatRatio(item.weight)}
			rankMetric={(item) => item.weight}
			renderExpanded={(item) => <WeightExpanded item={item} />}
			renderPrimary={(item) => <WeightPrimary item={item} />}
			renderSecondary={(item) => <WeightSecondary item={item} />}
			sortOptions={SORT_OPTIONS}
			title="指数成分权重"
		/>
	);
}
