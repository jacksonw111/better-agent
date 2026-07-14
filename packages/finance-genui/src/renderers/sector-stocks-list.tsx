import type { SectorConstituentData } from "./finance-schemas-fe6";
import { formatNum } from "./format";
import { ChangePct, StatGrid } from "./primitives";
import type { ProportionBarTone } from "./proportion-bar";
import { RankList } from "./rank-list";
import type { RankListSortOption } from "./rank-list-types";

// finance_sector_constituents → 板块成分股, ported onto the `RankList`
// archetype (design doc §8.6, contract So·F·E·I: "E 下钻 → 个股快照").
// `SectorConstituentData` carries no market-cap field, so the headline metric
// is |涨跌幅| — here the metric genuinely IS a price move, so (unlike every
// other tool in this task) its ProportionBar tone follows the price axis
// (`changeColor`-equivalent up/down) per row rather than one fixed neutral
// tone (§5.2 "该轴唯一例外"). Filter is omitted: the schema carries no
// discrete field to filter by.

const MAX_ROWS = 30;

const SORT_OPTIONS: RankListSortOption<SectorConstituentData>[] = [
	{ accessor: (row) => row.price, id: "price", label: "最新价" },
];

function moveTone(item: SectorConstituentData): ProportionBarTone {
	if (item.changePct === null || item.changePct === 0) {
		return "neutral";
	}
	return item.changePct > 0 ? "up" : "down";
}

function ConstituentPrimary({ item }: { item: SectorConstituentData }) {
	return (
		<div className="flex min-w-0 flex-col">
			<span className="truncate font-medium text-sm">
				{item.name || item.code || "—"}
			</span>
			<span className="truncate text-muted-foreground text-xs">
				{item.code || "—"}
			</span>
		</div>
	);
}

function ConstituentExpanded({ item }: { item: SectorConstituentData }) {
	return (
		<StatGrid
			cols={2}
			items={[
				{ label: "代码", value: item.code || "—" },
				{ label: "最新价", value: formatNum(item.price) },
			]}
		/>
	);
}

/** finance_sector_constituents → 板块成分股, capped at MAX_ROWS — this renders
 * inline in chat, not a full constituent list page. */
export function SectorStocksList({ data }: { data: SectorConstituentData[] }) {
	if (data.length === 0) {
		return null;
	}
	const visible = data.slice(0, MAX_ROWS);
	const hiddenCount = data.length - visible.length;

	return (
		<RankList
			footer={
				hiddenCount > 0 ? (
					<p className="text-muted-foreground text-xs">+{hiddenCount} more</p>
				) : null
			}
			getRowKey={(item, index) => `${item.code}-${index}`}
			items={visible}
			metricLabel="涨跌幅"
			metricTone={moveTone}
			metricValue={(item) => <ChangePct value={item.changePct} />}
			rankMetric={(item) =>
				item.changePct === null ? null : Math.abs(item.changePct)
			}
			renderExpanded={(item) => <ConstituentExpanded item={item} />}
			renderPrimary={(item) => <ConstituentPrimary item={item} />}
			renderSecondary={(item) => (
				<span className="text-sm tabular-nums">{formatNum(item.price)}</span>
			)}
			sortOptions={SORT_OPTIONS}
			title="板块成分股"
		/>
	);
}
