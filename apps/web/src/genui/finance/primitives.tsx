import { cn } from "@better-agent/ui/lib/utils";
import type { ReactNode } from "react";
import { changeColor, formatPct } from "./format";

// Shared presentational primitives for every finance tool-result card. shadcn
// tokens only (bg-card / text-foreground / text-muted-foreground / border),
// dark-aware, dense (this renders inline in chat, not a full page).

/** Signed percentage: red-up / green-down (红涨绿跌), tabular-nums, muted for
 * zero/missing. The single place every finance card gets its change color. */
export function ChangePct({
	value,
	className,
}: {
	value: number | null | undefined;
	className?: string;
}) {
	const color = changeColor(value);
	return (
		<span
			className={cn(
				"font-medium text-sm tabular-nums",
				color ? "" : "text-muted-foreground",
				className
			)}
			style={color ? { color } : undefined}
		>
			{formatPct(value)}
		</span>
	);
}

export interface StatGridItem {
	label: string;
	tone?: "up" | "down" | "muted" | "default";
	value: ReactNode;
}

const STAT_TONE_CLASS: Record<NonNullable<StatGridItem["tone"]>, string> = {
	default: "text-foreground",
	down: "text-[#16a34a]",
	muted: "text-muted-foreground",
	up: "text-[#ef4444]",
};

const COLS_TWO = 2;
const COLS_THREE = 3;
const COLS_FOUR = 4;
const DEFAULT_STAT_COLS = COLS_THREE;

const GRID_COLS_CLASS: Record<number, string> = {
	[COLS_TWO]: "grid-cols-2",
	[COLS_THREE]: "grid-cols-3",
	[COLS_FOUR]: "grid-cols-4",
};

/** Responsive labeled-stat grid, e.g. 今开/最高/最低/昨收 or MA5/MA10/MA20. */
export function StatGrid({
	items,
	cols = DEFAULT_STAT_COLS,
}: {
	items: StatGridItem[];
	cols?: number;
}) {
	const colsClass = GRID_COLS_CLASS[cols] ?? GRID_COLS_CLASS[DEFAULT_STAT_COLS];
	return (
		<div className={cn("grid gap-x-4 gap-y-2", colsClass)}>
			{items.map((item) => (
				<div className="flex flex-col gap-0.5" key={item.label}>
					<span className="text-muted-foreground text-xs">{item.label}</span>
					<span
						className={cn(
							"font-medium text-sm tabular-nums",
							STAT_TONE_CLASS[item.tone ?? "default"]
						)}
					>
						{item.value}
					</span>
				</div>
			))}
		</div>
	);
}

export interface FinTableColumn<T> {
	align?: "left" | "right" | "center";
	key: string;
	label: string;
	render?: (row: T) => ReactNode;
}

const ALIGN_CLASS: Record<
	NonNullable<FinTableColumn<unknown>["align"]>,
	string
> = {
	center: "text-center",
	left: "text-left",
	right: "text-right",
};

function FinTableHead<T>({ columns }: { columns: FinTableColumn<T>[] }) {
	return (
		<thead>
			<tr className="border-b bg-muted/40">
				{columns.map((col) => (
					<th
						className={cn(
							"px-3 py-2 text-left font-medium text-muted-foreground",
							ALIGN_CLASS[col.align ?? "left"]
						)}
						key={col.key}
					>
						{col.label}
					</th>
				))}
			</tr>
		</thead>
	);
}

function FinTableRow<T>({
	row,
	columns,
}: {
	row: T;
	columns: FinTableColumn<T>[];
}) {
	return (
		<tr className="border-b last:border-b-0 even:bg-muted/20">
			{columns.map((col) => (
				<td
					className={cn(
						"px-3 py-2 tabular-nums",
						ALIGN_CLASS[col.align ?? "left"]
					)}
					key={col.key}
				>
					{col.render ? col.render(row) : null}
				</td>
			))}
		</tr>
	);
}

/** Dense professional data table: tabular-nums, muted header, horizontal
 * scroll on overflow rather than squeezing columns. */
export function FinTable<T>({
	columns,
	rows,
	getRowKey,
}: {
	columns: FinTableColumn<T>[];
	rows: T[];
	getRowKey: (row: T, index: number) => string | number;
}) {
	return (
		<div className="overflow-x-auto rounded-lg border">
			<table className="w-full border-collapse text-xs">
				<FinTableHead columns={columns} />
				<tbody>
					{rows.map((row, index) => (
						<FinTableRow
							columns={columns}
							key={getRowKey(row, index)}
							row={row}
						/>
					))}
				</tbody>
			</table>
		</div>
	);
}

/** The consistent bordered card wrapper every finance component renders
 * inside — header row (title + optional subtitle + right-aligned slot) plus
 * body. Matches the density of tweet-card-node.tsx's card shell. */
export function CardShell({
	title,
	subtitle,
	right,
	children,
}: {
	title: string;
	subtitle?: string;
	right?: ReactNode;
	children: ReactNode;
}) {
	return (
		<div className="flex w-full flex-col gap-3 rounded-xl border bg-card p-4">
			<div className="flex items-start justify-between gap-2">
				<div className="flex min-w-0 flex-col gap-0.5">
					<span className="truncate font-semibold text-sm">{title}</span>
					{subtitle ? (
						<span className="truncate text-muted-foreground text-xs">
							{subtitle}
						</span>
					) : null}
				</div>
				{right ? <div className="shrink-0">{right}</div> : null}
			</div>
			{children}
		</div>
	);
}
