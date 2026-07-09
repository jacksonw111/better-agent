import type { OptionRowData } from "./finance-schemas-fe14";
import { formatCompact, formatNum } from "./format";
import {
	CardShell,
	ChangePct,
	FinTable,
	type FinTableColumn,
} from "./primitives";

const MAX_STRIKES = 20;

interface StrikeRow {
	call?: OptionRowData;
	put?: OptionRowData;
	strike: number;
}

/** Groups option rows by strike price: for each strike, at most one call leg
 * and one put leg. Rows without a strike can't be placed on the T-board and
 * are dropped. */
function groupByStrike(data: OptionRowData[]): StrikeRow[] {
	const byStrike = new Map<number, StrikeRow>();
	for (const row of data) {
		if (row.strike === null) {
			continue;
		}
		const existing = byStrike.get(row.strike) ?? { strike: row.strike };
		if (row.kind === "call") {
			existing.call = row;
		} else {
			existing.put = row;
		}
		byStrike.set(row.strike, existing);
	}
	return [...byStrike.values()].sort((a, b) => a.strike - b.strike);
}

function Missing() {
	return <span className="text-muted-foreground">—</span>;
}

const OPTION_CHAIN_COLUMNS: FinTableColumn<StrikeRow>[] = [
	{
		align: "right",
		key: "callChangePct",
		label: "认购涨跌幅",
		render: (row) =>
			row.call ? <ChangePct value={row.call.changePct} /> : <Missing />,
	},
	{
		align: "right",
		key: "callLast",
		label: "认购价",
		render: (row) => (row.call ? formatNum(row.call.last) : <Missing />),
	},
	{
		align: "right",
		key: "callVolume",
		label: "认购量",
		render: (row) => (row.call ? formatCompact(row.call.volume) : <Missing />),
	},
	{
		align: "center",
		key: "strike",
		label: "行权价",
		render: (row) => (
			<span className="font-semibold">{formatNum(row.strike)}</span>
		),
	},
	{
		align: "right",
		key: "putVolume",
		label: "认沽量",
		render: (row) => (row.put ? formatCompact(row.put.volume) : <Missing />),
	},
	{
		align: "right",
		key: "putLast",
		label: "认沽价",
		render: (row) => (row.put ? formatNum(row.put.last) : <Missing />),
	},
	{
		align: "right",
		key: "putChangePct",
		label: "认沽涨跌幅",
		render: (row) =>
			row.put ? <ChangePct value={row.put.changePct} /> : <Missing />,
	},
];

/** finance_option_chain → ETF 期权链 T 型报价板: rows keyed by strike price
 * (ascending), with the 认购 (call) leg on the left and 认沽 (put) leg on
 * the right of the 行权价 column, capped at MAX_STRIKES strikes. A missing
 * leg (no call or no put quoted at a given strike) renders as "—". */
export function OptionChain({ data }: { data: OptionRowData[] }) {
	if (data.length === 0) {
		return null;
	}
	const strikeRows = groupByStrike(data);
	if (strikeRows.length === 0) {
		return null;
	}
	const visible = strikeRows.slice(0, MAX_STRIKES);
	const hiddenCount = strikeRows.length - visible.length;
	return (
		<CardShell title="期权链">
			<FinTable
				columns={OPTION_CHAIN_COLUMNS}
				getRowKey={(row) => row.strike}
				rows={visible}
			/>
			{hiddenCount > 0 ? (
				<p className="text-muted-foreground text-xs">+{hiddenCount} more</p>
			) : null}
		</CardShell>
	);
}
