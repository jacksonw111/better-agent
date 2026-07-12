// apps/web/src/components/dashboard/activity-heatmap.tsx

import { useMemo, useState } from "react";
import {
	buildWeeks,
	CELL_GAP,
	CELL_SIZE,
	DAY_LABEL_ROWS,
	type HeatmapCell,
	type HeatmapWeek,
	LEVELS_DARK,
	LEVELS_LIGHT,
	parseUtcDay,
} from "./heatmap-utils";
import { useHeatmapData } from "./use-heatmap-data";

const LEGEND_SWATCH_SIZE = 11;
const SKELETON_WEEK_COUNT = 26;
const DAYS_PER_WEEK = 7;

type Tooltip = { cell: HeatmapCell; x: number; y: number } | null;

function HeatmapTooltip({
	cell,
	x,
	y,
}: {
	cell: HeatmapCell;
	x: number;
	y: number;
}) {
	const label = parseUtcDay(cell.day).toLocaleDateString("en-US", {
		day: "numeric",
		month: "short",
		timeZone: "UTC",
		weekday: "short",
	});
	return (
		<div
			className="pointer-events-none fixed z-50 rounded-lg border bg-popover px-3 py-2 text-xs shadow-md"
			style={{ left: x + 14, top: y - 40 }}
		>
			<p className="font-medium">{label}</p>
			<p className="text-muted-foreground">{cell.turns} turns</p>
		</div>
	);
}

const weekKey = (i: number) => `wk${i}`;
const cellKey = (wi: number, di: number) => `c${wi}-${di}`;
const legendKey = (i: number) => `lv${i}`;
const dayLabelKey = (i: number) => `dl${i}`;

interface WeekCellProps {
	cell: HeatmapCell | null;
	di: number;
	palette: string[];
	setTooltip: (t: Tooltip) => void;
	wi: number;
}

function WeekCell({ cell, di, palette, setTooltip, wi }: WeekCellProps) {
	if (!cell) {
		return (
			<div
				aria-hidden
				key={cellKey(wi, di)}
				style={{ height: CELL_SIZE, width: CELL_SIZE }}
			/>
		);
	}
	return (
		<button
			aria-label={`${cell.day}: ${cell.turns} turns`}
			className="rounded-sm border-0 p-0 transition-colors hover:ring-1 hover:ring-foreground/30"
			key={cellKey(wi, di)}
			onMouseEnter={(e) => setTooltip({ cell, x: e.clientX, y: e.clientY })}
			onMouseLeave={() => setTooltip(null)}
			style={{
				backgroundColor: palette[cell.level],
				height: CELL_SIZE,
				width: CELL_SIZE,
			}}
			type="button"
		/>
	);
}

/**
 * One month-label row. Rendered with identical markup whether or not it has
 * a label (an invisible `&nbsp;` row otherwise) — that's what the day-label
 * column's top spacer reuses verbatim, so the two columns' heights can never
 * drift apart the way a guessed pixel constant did before.
 */
function MonthLabelRow({ label }: { label: string | null }) {
	if (label) {
		return (
			<span className="mb-0.5 text-muted-foreground text-xs">{label}</span>
		);
	}
	return (
		<span aria-hidden className="mb-0.5 text-xs">
			&nbsp;
		</span>
	);
}

function HeatmapGrid({
	palette,
	setTooltip,
	weeks,
}: {
	palette: string[];
	setTooltip: (t: Tooltip) => void;
	weeks: HeatmapWeek[];
}) {
	return (
		<>
			{weeks.map((week, wi) => (
				<div
					className="flex flex-col"
					key={weekKey(wi)}
					style={{ gap: CELL_GAP }}
				>
					<MonthLabelRow label={week.monthLabel} />
					{Array.from({ length: DAYS_PER_WEEK }, (_, di) => (
						<WeekCell
							cell={week.cells[di] ?? null}
							di={di}
							key={cellKey(wi, di)}
							palette={palette}
							setTooltip={setTooltip}
							wi={wi}
						/>
					))}
				</div>
			))}
		</>
	);
}

/**
 * Mon/Wed/Fri labels, one per grid row. Uses the SAME pitch (`CELL_SIZE` +
 * `CELL_GAP`, via inline `style`) and the SAME top spacer markup as the
 * grid's week columns, so row N here always lines up with row N of cells —
 * previously this stretched 3 labels across the column with `justify-around`
 * and a separately-guessed row height, which drifted from the grid's real
 * pitch.
 */
function DayLabelColumn() {
	return (
		<div className="flex flex-col pr-1 text-muted-foreground text-xs">
			<MonthLabelRow label={null} />
			<div className="flex flex-col" style={{ gap: CELL_GAP }}>
				{DAY_LABEL_ROWS.map((label, i) => (
					<span
						className="flex items-center leading-none"
						key={dayLabelKey(i)}
						style={{ height: CELL_SIZE }}
					>
						{label ?? " "}
					</span>
				))}
			</div>
		</div>
	);
}

function HeatmapLegend({ palette }: { palette: string[] }) {
	return (
		<div className="mt-3 flex items-center gap-2 text-muted-foreground text-xs">
			<span>Less</span>
			{palette.map((color, i) => (
				<div
					className="rounded-sm"
					key={legendKey(i)}
					style={{
						backgroundColor: color,
						height: LEGEND_SWATCH_SIZE,
						width: LEGEND_SWATCH_SIZE,
					}}
				/>
			))}
			<span>More</span>
		</div>
	);
}

function HeatmapSkeleton() {
	return (
		<div aria-hidden className="flex animate-pulse gap-1 overflow-x-auto">
			{Array.from({ length: SKELETON_WEEK_COUNT }, (_, wi) => (
				<div
					className="flex flex-col"
					key={weekKey(wi)}
					style={{ gap: CELL_GAP }}
				>
					{Array.from({ length: DAYS_PER_WEEK }, (_, di) => (
						<div
							className="rounded-sm bg-muted"
							key={cellKey(wi, di)}
							style={{ height: CELL_SIZE, width: CELL_SIZE }}
						/>
					))}
				</div>
			))}
		</div>
	);
}

function useIsDarkMode(): boolean {
	return (
		typeof document !== "undefined" &&
		document.documentElement.classList.contains("dark")
	);
}

/** GitHub-style ~3-month activity heatmap. Fetches its own wide-window data
 * (`useHeatmapData`) — deliberately independent of the dashboard's 3/7/12
 * `window-toggle`, which only drives the token chart above it. */
export function ActivityHeatmap() {
	const { daily, isPending } = useHeatmapData();
	const weeks = useMemo(() => buildWeeks(daily), [daily]);
	const [tooltip, setTooltip] = useState<Tooltip>(null);
	const isDark = useIsDarkMode();
	const palette = isDark ? LEVELS_DARK : LEVELS_LIGHT;

	return (
		<div className="rounded-xl bg-card p-4 ring-1 ring-foreground/10">
			<p className="mb-3 font-medium text-sm">Activity</p>
			{isPending ? (
				<HeatmapSkeleton />
			) : (
				<div className="flex gap-1 overflow-x-auto">
					<DayLabelColumn />
					<HeatmapGrid
						palette={palette}
						setTooltip={setTooltip}
						weeks={weeks}
					/>
				</div>
			)}
			<HeatmapLegend palette={palette} />
			{tooltip ? <HeatmapTooltip {...tooltip} /> : null}
		</div>
	);
}
