import { MAX_RENDERED_ITEMS } from "../tool-renderers";
import type { EtfRowData } from "./finance-schemas-fe14";
import { formatCompact, formatNum, formatRatio } from "./format";
import {
	CardShell,
	ChangePct,
	FinTable,
	type FinTableColumn,
} from "./primitives";

const ETF_COLUMNS: FinTableColumn<EtfRowData>[] = [
	{ key: "name", label: "名称", render: (row) => row.name || row.code },
	{ key: "code", label: "代码" },
	{
		align: "right",
		key: "price",
		label: "最新价",
		render: (row) => formatNum(row.price),
	},
	{
		align: "right",
		key: "changePct",
		label: "涨跌幅",
		render: (row) => <ChangePct value={row.changePct} />,
	},
	{
		align: "right",
		key: "volume",
		label: "成交量",
		render: (row) => formatCompact(row.volume),
	},
	{
		align: "right",
		key: "turnoverRate",
		label: "换手率",
		render: (row) => formatRatio(row.turnoverRate),
	},
];

/** finance_etf_list → A股 ETF 列表, ranked by change% (the tool already
 * returns rows in that order), capped at MAX_RENDERED_ITEMS. */
export function EtfList({ data }: { data: EtfRowData[] }) {
	if (data.length === 0) {
		return null;
	}
	const visible = data.slice(0, MAX_RENDERED_ITEMS);
	const hiddenCount = data.length - visible.length;
	return (
		<CardShell title="ETF">
			<FinTable
				columns={ETF_COLUMNS}
				getRowKey={(row, index) => `${row.code}-${index}`}
				rows={visible}
			/>
			{hiddenCount > 0 ? (
				<p className="text-muted-foreground text-xs">+{hiddenCount} more</p>
			) : null}
		</CardShell>
	);
}
