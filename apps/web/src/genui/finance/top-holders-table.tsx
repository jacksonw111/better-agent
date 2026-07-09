import { Badge } from "@better-agent/ui/components/badge";
import type { HolderRowData } from "./finance-schemas";
import { changeColor, formatCompact, formatDate, formatRatio } from "./format";
import {
	CardShell,
	ChangePct,
	FinTable,
	type FinTableColumn,
} from "./primitives";

/** Signed compact share-count delta, colored red-up/green-down (红涨绿跌) like
 * `ChangePct`, but for an absolute share count rather than a percentage. */
function SignedShares({ value }: { value: number | null }) {
	if (value === null || Number.isNaN(value)) {
		return <span className="text-muted-foreground">—</span>;
	}
	const color = changeColor(value);
	const sign = value > 0 ? "+" : "";
	return (
		<span style={color ? { color } : undefined}>
			{sign}
			{formatCompact(value)}
		</span>
	);
}

function HolderName({ row }: { row: HolderRowData }) {
	return (
		<div className="flex min-w-0 items-center gap-1.5">
			<span className="max-w-48 truncate" title={row.holder}>
				{row.holder}
			</span>
			{row.isInstitution ? (
				<Badge className="shrink-0" variant="outline">
					机构
				</Badge>
			) : null}
		</div>
	);
}

const HOLDER_COLUMNS: FinTableColumn<HolderRowData>[] = [
	{
		align: "right",
		key: "rank",
		label: "排名",
		render: (row) => row.rank ?? "—",
	},
	{
		key: "holder",
		label: "股东名称",
		render: (row) => <HolderName row={row} />,
	},
	{
		align: "right",
		key: "shares",
		label: "持股数",
		render: (row) => formatCompact(row.shares),
	},
	{
		align: "right",
		key: "freeFloatRatio",
		label: "流通占比",
		render: (row) => formatRatio(row.freeFloatRatio),
	},
	{
		align: "right",
		key: "changeShares",
		label: "较上期变动",
		render: (row) => <SignedShares value={row.changeShares} />,
	},
	{
		align: "right",
		key: "changeRatio",
		label: "变动比例",
		render: (row) => <ChangePct value={row.changeRatio} />,
	},
];

/** finance_top_holders → 十大流通股东, newest `endDate` first (the tool
 * already returns rows in that order). */
export function TopHoldersTable({ data }: { data: HolderRowData[] }) {
	if (data.length === 0) {
		return null;
	}
	return (
		<CardShell subtitle={formatDate(data[0]?.endDate)} title="十大流通股东">
			<FinTable
				columns={HOLDER_COLUMNS}
				getRowKey={(row, index) => `${row.holder}-${index}`}
				rows={data}
			/>
		</CardShell>
	);
}
