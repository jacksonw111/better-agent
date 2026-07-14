import { cn } from "@better-agent/ui/lib/utils";
import { motion } from "motion/react";
import type { OptionRowData } from "./finance-schemas-fe14";
import { formatCompact, formatNum } from "./format";
import {
	EASE_OUT,
	rowItemVariants,
	staggerContainerVariants,
	TRANSITION_MS,
} from "./motion";
import type { ChainFilter } from "./option-chain-controls";
import type { StrikeRow } from "./option-chain-types";
import { ChangePct, type FinTableColumn } from "./primitives";

// LadderTable board (design doc §8.5) — the mirrored Calls | 行权价 | Puts
// table body plus a row's Expand detail. Single consumer, kept concrete (see
// option-chain-types.ts's module comment). F/So controls live in
// option-chain-controls.tsx; orchestration state (filter/sort/expand) in
// option-chain.tsx.

const MS_PER_SECOND = 1000;
const EXPAND_FADE_SECONDS = TRANSITION_MS / MS_PER_SECOND;

function Missing() {
	return <span className="text-muted-foreground">—</span>;
}

const CALL_COLUMNS: FinTableColumn<StrikeRow>[] = [
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
];

const STRIKE_COLUMN: FinTableColumn<StrikeRow> = {
	align: "center",
	key: "strike",
	label: "行权价",
	render: (row) => (
		<span className="font-semibold">{formatNum(row.strike)}</span>
	),
};

const PUT_COLUMNS: FinTableColumn<StrikeRow>[] = [
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

/** Filter narrows which wing's columns are visible; the row set never
 * changes (never invent a row-level filtering rule the payload doesn't
 * support — a strike still belongs on the board even if its shown wing is
 * missing that leg, which renders "—" same as today). */
function visibleColumns(filter: ChainFilter): FinTableColumn<StrikeRow>[] {
	if (filter === "call") {
		return [...CALL_COLUMNS, STRIKE_COLUMN];
	}
	if (filter === "put") {
		return [STRIKE_COLUMN, ...PUT_COLUMNS];
	}
	return [...CALL_COLUMNS, STRIKE_COLUMN, ...PUT_COLUMNS];
}

function alignClass(align: FinTableColumn<unknown>["align"]): string {
	if (align === "right") {
		return "text-right";
	}
	if (align === "center") {
		return "text-center";
	}
	return "text-left";
}

function BoardHead({ columns }: { columns: FinTableColumn<StrikeRow>[] }) {
	return (
		<thead>
			<tr className="bg-muted/40">
				{columns.map((col) => (
					<th
						className={cn(
							"px-3 py-2 font-medium text-muted-foreground",
							alignClass(col.align)
						)}
						key={col.key}
						scope="col"
					>
						{col.label}
					</th>
				))}
			</tr>
		</thead>
	);
}

function LegDetail({
	label,
	leg,
}: {
	label: string;
	leg: OptionRowData | undefined;
}) {
	return (
		<p className="text-muted-foreground text-xs">
			{label} {leg ? `${leg.code} ${leg.name || "—"}` : "—"}
		</p>
	);
}

/** Expand reveal: opacity crossfade (§6 "行展开 crossfade"), reduced-motion
 * snaps instantly — mirrors rank-list-row.tsx's `RowExpanded`. */
function RowExpandedDetail({
	reduced,
	row,
}: {
	reduced: boolean;
	row: StrikeRow;
}) {
	return (
		<motion.div
			animate={{ opacity: 1 }}
			className="flex flex-col gap-1 py-1"
			initial={reduced ? false : { opacity: 0 }}
			transition={
				reduced
					? { duration: 0 }
					: { duration: EXPAND_FADE_SECONDS, ease: EASE_OUT }
			}
		>
			<LegDetail label="认购" leg={row.call} />
			<LegDetail label="认沽" leg={row.put} />
		</motion.div>
	);
}

/** Enter/Space activates a clickable row, matching its onClick (a11y parity
 * for the keyboard, mirrors data-table-grid.tsx / rank-list-row.tsx). */
function activateOnKey(
	event: { key: string; preventDefault: () => void },
	run: () => void
) {
	if (event.key === "Enter" || event.key === " ") {
		event.preventDefault();
		run();
	}
}

function BoardRow({
	columns,
	expanded,
	onToggleExpand,
	reduced,
	row,
}: {
	columns: FinTableColumn<StrikeRow>[];
	expanded: boolean;
	onToggleExpand: () => void;
	reduced: boolean;
	row: StrikeRow;
}) {
	return (
		<>
			<motion.tr
				aria-expanded={expanded}
				className="cursor-pointer transition-colors even:bg-muted/20 hover:bg-muted/40 active:bg-muted/50"
				onClick={onToggleExpand}
				onKeyDown={(event) => activateOnKey(event, onToggleExpand)}
				tabIndex={0}
				variants={rowItemVariants(reduced)}
			>
				{columns.map((col) => (
					<td
						className={cn("px-3 py-2 tabular-nums", alignClass(col.align))}
						key={col.key}
					>
						{col.render ? col.render(row) : null}
					</td>
				))}
			</motion.tr>
			{expanded ? (
				<tr className="bg-muted/10">
					<td className="px-3 py-2.5" colSpan={columns.length}>
						<RowExpandedDetail reduced={reduced} row={row} />
					</td>
				</tr>
			) : null}
		</>
	);
}

export function OptionChainBoard({
	filter,
	isExpanded,
	onToggleExpand,
	reduced,
	rows,
}: {
	filter: ChainFilter;
	isExpanded: (key: string) => boolean;
	onToggleExpand: (key: string) => void;
	reduced: boolean;
	rows: StrikeRow[];
}) {
	const columns = visibleColumns(filter);
	return (
		<div className="overflow-x-auto rounded-md">
			<table className="w-full border-collapse text-left text-xs">
				<BoardHead columns={columns} />
				<motion.tbody
					animate="visible"
					initial="hidden"
					variants={staggerContainerVariants(reduced)}
				>
					{rows.map((row) => (
						<BoardRow
							columns={columns}
							expanded={isExpanded(String(row.strike))}
							key={row.strike}
							onToggleExpand={() => onToggleExpand(String(row.strike))}
							reduced={reduced}
							row={row}
						/>
					))}
				</motion.tbody>
			</table>
		</div>
	);
}
