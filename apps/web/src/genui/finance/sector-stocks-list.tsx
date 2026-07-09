import type { SectorConstituentData } from "./finance-schemas-fe6";
import { formatNum } from "./format";
import {
	CardShell,
	ChangePct,
	FinTable,
	type FinTableColumn,
} from "./primitives";

const MAX_ROWS = 30;

const SECTOR_STOCK_COLUMNS: FinTableColumn<SectorConstituentData>[] = [
	{
		key: "name",
		label: "名称",
		render: (row) => row.name || row.code || "—",
	},
	{
		key: "code",
		label: "代码",
		render: (row) => row.code || "—",
	},
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
];

/** finance_sector_constituents → 板块成分股, capped at MAX_ROWS — this renders
 * inline in chat, not a full constituent list page. */
export function SectorStocksList({ data }: { data: SectorConstituentData[] }) {
	if (data.length === 0) {
		return null;
	}
	const visible = data.slice(0, MAX_ROWS);
	const hiddenCount = data.length - visible.length;
	return (
		<CardShell title="板块成分股">
			<FinTable
				columns={SECTOR_STOCK_COLUMNS}
				getRowKey={(row, index) => `${row.code}-${index}`}
				rows={visible}
			/>
			{hiddenCount > 0 ? (
				<p className="text-muted-foreground text-xs">+{hiddenCount} more</p>
			) : null}
		</CardShell>
	);
}
