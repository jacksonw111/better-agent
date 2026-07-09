import { MAX_RENDERED_ITEMS } from "../tool-renderers";
import type { StockHitData } from "./finance-schemas-fe8";
import { CardShell, FinTable, type FinTableColumn } from "./primitives";

const SEARCH_COLUMNS: FinTableColumn<StockHitData>[] = [
	{ key: "name", label: "名称", render: (row) => row.name || "—" },
	{ key: "code", label: "代码", render: (row) => row.code },
	{
		key: "exchange",
		label: "交易所",
		render: (row) => row.exchange || "—",
	},
];

/** finance_search → 股票搜索结果, capped at MAX_RENDERED_ITEMS. */
export function SearchList({ data }: { data: StockHitData[] }) {
	if (data.length === 0) {
		return null;
	}
	const visible = data.slice(0, MAX_RENDERED_ITEMS);
	const hiddenCount = data.length - visible.length;
	return (
		<CardShell title="股票搜索结果">
			<FinTable
				columns={SEARCH_COLUMNS}
				getRowKey={(row, index) => `${row.code}-${index}`}
				rows={visible}
			/>
			{hiddenCount > 0 ? (
				<p className="text-muted-foreground text-xs">+{hiddenCount} more</p>
			) : null}
		</CardShell>
	);
}
