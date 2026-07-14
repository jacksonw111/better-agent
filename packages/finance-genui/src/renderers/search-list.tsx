import { MAX_RENDERED_ITEMS } from "../registry/entry";
import type { StockHitData } from "./finance-schemas-fe8";
import { StatGrid } from "./primitives";
import { RankList } from "./rank-list";
import type { RankListFilter } from "./rank-list-types";

// finance_search → 股票搜索结果, ported onto the `RankList` archetype (design
// doc §8.6, contract So·F·E·I: "E 下钻 → quote"). `StockHitData` carries
// neither a relevance score nor a change%, so the headline metric is a
// synthetic position-based proxy (`visibleCount - index`): search results
// already arrive relevance-ordered, so this just makes that order visible as
// a decaying bar. It has no meaningful display value of its own, so
// `metricValue` is omitted (per rank-list-types.ts's documented convention).
// Filter uses 交易所 (`exchange`, SH/SZ/BJ — genuinely varies) rather than
// 市场 (`market`, always the literal "a_share" in this payload, so filtering
// by it would never narrow anything).

const EXCHANGE_LABEL: Record<string, string> = {
	BJ: "北交所",
	SH: "上交所",
	SZ: "深交所",
};

const MARKET_LABEL: Record<string, string> = {
	a_share: "A股",
};

/** Filtering by 交易所 is only useful once results actually span more than
 * one exchange. */
const MIN_DISTINCT_EXCHANGES_FOR_FILTER = 2;

interface SearchHit extends StockHitData {
	relevance: number;
}

function exchangeFilters(data: StockHitData[]): RankListFilter<SearchHit>[] {
	const values = new Set<string>();
	for (const row of data) {
		if (row.exchange) {
			values.add(row.exchange);
		}
	}
	if (values.size < MIN_DISTINCT_EXCHANGES_FOR_FILTER) {
		return [];
	}
	return [...values].map((value) => ({
		id: value,
		label: EXCHANGE_LABEL[value] ?? value,
		predicate: (item) => item.exchange === value,
	}));
}

function SearchPrimary({ item }: { item: SearchHit }) {
	return (
		<div className="flex min-w-0 flex-col">
			<span className="truncate font-medium text-sm">{item.name || "—"}</span>
			<span className="truncate text-muted-foreground text-xs">
				{item.code}
			</span>
		</div>
	);
}

function SearchExpanded({ item }: { item: SearchHit }) {
	return (
		<StatGrid
			cols={3}
			items={[
				{ label: "代码", value: item.code },
				{ label: "交易所", value: item.exchange || "—" },
				{
					label: "市场",
					value: MARKET_LABEL[item.market] ?? (item.market || "—"),
				},
			]}
		/>
	);
}

/** finance_search → 股票搜索结果, capped at MAX_RENDERED_ITEMS. */
export function SearchList({ data }: { data: StockHitData[] }) {
	if (data.length === 0) {
		return null;
	}
	const visible = data.slice(0, MAX_RENDERED_ITEMS);
	const hiddenCount = data.length - visible.length;
	const items: SearchHit[] = visible.map((item, index) => ({
		...item,
		relevance: visible.length - index,
	}));

	return (
		<RankList
			filters={exchangeFilters(visible)}
			footer={
				hiddenCount > 0 ? (
					<p className="text-muted-foreground text-xs">+{hiddenCount} more</p>
				) : null
			}
			getRowKey={(item, index) => `${item.code}-${index}`}
			items={items}
			metricLabel="相关度"
			metricTone="probability"
			rankMetric={(item) => item.relevance}
			renderExpanded={(item) => <SearchExpanded item={item} />}
			renderPrimary={(item) => <SearchPrimary item={item} />}
			renderSecondary={(item) => (
				<span className="text-muted-foreground text-xs">
					{item.exchange || "—"}
				</span>
			)}
			title="股票搜索结果"
		/>
	);
}
