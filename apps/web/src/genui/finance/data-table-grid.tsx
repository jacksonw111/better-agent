import { cn } from "@better-agent/ui/lib/utils";
import { ArrowDown, ArrowUp } from "lucide-react";
import { motion } from "motion/react";
import type { ReactNode } from "react";
import type { DataTableColumn } from "./data-table-types";
import {
	rowItemVariants,
	staggerContainerVariants,
	useReducedMotion,
} from "./motion";
import type { SortDirection } from "./use-sort";

// Phase 1 Task 1 — the grid (table) view of the `DataTable` primitive (design
// doc §8.1). Sortable muted headers, tabular-nums right-aligned numerics, row
// hover, very-faint zebra, an optional inline expand row, and the categoryKey
// column pinned sticky-left so narrow viewports scroll it into a fixed anchor
// (spec §7). Zero border/ring — depth is tint + spacing only (§5.1).

const SORT_ICON_SIZE = 14;

function alignClass(align: DataTableColumn<unknown>["align"]): string {
	if (align === "right") {
		return "text-right";
	}
	if (align === "center") {
		return "text-center";
	}
	return "text-left";
}

function isSortable<T>(col: DataTableColumn<T>): boolean {
	return col.sortable ?? col.value !== undefined;
}

function ariaSort(
	active: boolean,
	dir: SortDirection
): "ascending" | "descending" | "none" {
	if (!active) {
		return "none";
	}
	return dir === "asc" ? "ascending" : "descending";
}

interface GridSort {
	dir: SortDirection;
	key: string | undefined;
	onToggle: (key: string) => void;
}

function HeaderCell<T>({
	col,
	sort,
	sticky,
}: {
	col: DataTableColumn<T>;
	sort: GridSort;
	sticky: boolean;
}) {
	const active = sort.key === col.key;
	const base = cn(
		"whitespace-nowrap px-3 py-2 font-medium text-muted-foreground",
		alignClass(col.align),
		sticky && "sticky left-0 z-10 bg-muted/40"
	);
	if (!isSortable(col)) {
		return (
			<th className={base} scope="col">
				{col.label}
			</th>
		);
	}
	return (
		<th aria-sort={ariaSort(active, sort.dir)} className={base} scope="col">
			<button
				className="inline-flex min-h-11 items-center gap-1 font-medium text-muted-foreground active:scale-95"
				onClick={() => sort.onToggle(col.key)}
				type="button"
			>
				{col.label}
				{active && sort.dir === "asc" ? (
					<ArrowUp size={SORT_ICON_SIZE} />
				) : null}
				{active && sort.dir === "desc" ? (
					<ArrowDown size={SORT_ICON_SIZE} />
				) : null}
			</button>
		</th>
	);
}

function DataCell<T>({
	col,
	row,
	sticky,
}: {
	col: DataTableColumn<T>;
	row: T;
	sticky: boolean;
}) {
	const content = col.render
		? col.render(row)
		: ((row as Record<string, ReactNode>)[col.key] ?? null);
	return (
		<td
			className={cn(
				"px-3 py-2 tabular-nums",
				alignClass(col.align),
				sticky && "sticky left-0 z-10 bg-background"
			)}
		>
			{content}
		</td>
	);
}

interface GridExpand<T> {
	isExpanded: (key: string) => boolean;
	onToggle: (key: string) => void;
	render?: (row: T) => ReactNode;
}

/** Enter/Space activates a clickable row, matching its onClick (a11y parity
 * for the keyboard, per project standards). */
function activateOnKey(
	event: { key: string; preventDefault: () => void },
	run: () => void
) {
	if (event.key === "Enter" || event.key === " ") {
		event.preventDefault();
		run();
	}
}

function RowCells<T>({
	categoryKey,
	columns,
	row,
}: {
	categoryKey: string;
	columns: DataTableColumn<T>[];
	row: T;
}) {
	return (
		<>
			{columns.map((col) => (
				<DataCell
					col={col}
					key={col.key}
					row={row}
					sticky={col.key === categoryKey}
				/>
			))}
		</>
	);
}

function BodyRow<T>({
	columns,
	categoryKey,
	expand,
	reduced,
	row,
	rowKey,
}: {
	categoryKey: string;
	columns: DataTableColumn<T>[];
	expand: GridExpand<T>;
	reduced: boolean;
	row: T;
	rowKey: string;
}) {
	const expandable = expand.render !== undefined;
	const open = expand.isExpanded(rowKey);
	const activate = () => expand.onToggle(rowKey);
	return (
		<>
			<motion.tr
				aria-expanded={expandable ? open : undefined}
				className={cn(
					"transition-colors even:bg-muted/20 hover:bg-muted/40",
					expandable && "cursor-pointer active:bg-muted/50"
				)}
				onClick={expandable ? activate : undefined}
				onKeyDown={
					expandable ? (event) => activateOnKey(event, activate) : undefined
				}
				tabIndex={expandable ? 0 : undefined}
				variants={rowItemVariants(reduced)}
			>
				<RowCells categoryKey={categoryKey} columns={columns} row={row} />
			</motion.tr>
			{expandable && open ? (
				<tr className="bg-muted/10">
					<td className="px-3 py-2.5" colSpan={columns.length}>
						{expand.render?.(row)}
					</td>
				</tr>
			) : null}
		</>
	);
}

function GridHead<T>({
	categoryKey,
	columns,
	sort,
}: {
	categoryKey: string;
	columns: DataTableColumn<T>[];
	sort: GridSort;
}) {
	return (
		<thead>
			<tr className="bg-muted/40">
				{columns.map((col) => (
					<HeaderCell
						col={col}
						key={col.key}
						sort={sort}
						sticky={col.key === categoryKey}
					/>
				))}
			</tr>
		</thead>
	);
}

export function DataTableGrid<T>({
	categoryKey,
	columns,
	expand,
	getRowKey,
	rows,
	sort,
}: {
	categoryKey: string;
	columns: DataTableColumn<T>[];
	expand: GridExpand<T>;
	getRowKey: (row: T, index: number) => string | number;
	rows: T[];
	sort: GridSort;
}) {
	const reduced = useReducedMotion() ?? false;
	return (
		<div className="overflow-x-auto rounded-md">
			<table className="w-full border-collapse text-left text-xs">
				<GridHead categoryKey={categoryKey} columns={columns} sort={sort} />
				<motion.tbody
					animate="visible"
					initial="hidden"
					variants={staggerContainerVariants(reduced)}
				>
					{rows.map((row, index) => (
						<BodyRow
							categoryKey={categoryKey}
							columns={columns}
							expand={expand}
							key={getRowKey(row, index)}
							reduced={reduced}
							row={row}
							rowKey={String(getRowKey(row, index))}
						/>
					))}
				</motion.tbody>
			</table>
		</div>
	);
}
