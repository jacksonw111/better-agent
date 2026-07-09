import type { LockupRowData } from "./finance-schemas-fe13";
import { formatCompact, formatDate, formatNum } from "./format";
import { CardShell, FinTable, type FinTableColumn } from "./primitives";

// finance_lockup → 限售解禁. `freeRatio` comes straight through from
// EastMoney's RPT_LIFT_STAGE report as-is (its scale isn't pinned down —
// could already be a %-scale number or a small decimal) so this renders it
// with a literal "%" suffix rather than guessing at a conversion.

const LOCKUP_COLUMNS: FinTableColumn<LockupRowData>[] = [
	{
		key: "freeDate",
		label: "解禁日",
		render: (row) => formatDate(row.freeDate),
	},
	{ key: "name", label: "名称", render: (row) => row.name || row.code || "—" },
	{
		align: "right",
		key: "freeShares",
		label: "解禁数量",
		render: (row) => formatCompact(row.freeShares),
	},
	{
		align: "right",
		key: "freeRatio",
		label: "占总股本%",
		render: (row) =>
			row.freeRatio === null ? "—" : `${formatNum(row.freeRatio)}%`,
	},
	{
		align: "right",
		key: "liftMarketCap",
		label: "解禁市值",
		render: (row) => formatCompact(row.liftMarketCap, { cny: true }),
	},
	{ key: "type", label: "类型", render: (row) => row.type || "—" },
];

/** finance_lockup → 限售解禁, soonest `freeDate` first for a market-wide
 * query, newest-first history for a single symbol (the tool already returns
 * rows in the right order for each case). */
export function LockupTable({ data }: { data: LockupRowData[] }) {
	if (data.length === 0) {
		return null;
	}
	return (
		<CardShell title="限售解禁">
			<FinTable
				columns={LOCKUP_COLUMNS}
				getRowKey={(row, index) => `${row.code}-${row.freeDate}-${index}`}
				rows={data}
			/>
		</CardShell>
	);
}
