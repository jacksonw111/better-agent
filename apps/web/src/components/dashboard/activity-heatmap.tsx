import { useMemo, useState } from "react";
import type { DayPoint } from "./use-usage-data";

// GitHub-style 5-level intensity palette — mirrors TokenTracker's
// ActivityHeatmap (ebedf0 → 10b981 in light, 30363d → 34d399 in dark).
const LEVELS_LIGHT = ["#ebedf0", "#a7f3d0", "#6ee7b7", "#34d399", "#10b981"];
const LEVELS_DARK = ["#30363d", "#065f46", "#059669", "#10b981", "#34d399"];
const CELL_SIZE = 13;
const CELL_GAP = 3;
const DAY_LABELS = ["Mon", "Wed", "Fri"];
const MONTH_LABELS = [
	"Jan",
	"Feb",
	"Mar",
	"Apr",
	"May",
	"Jun",
	"Jul",
	"Aug",
	"Sep",
	"Oct",
	"Nov",
	"Dec",
];

interface HeatmapCell {
	day: string;
	level: number;
	turns: number;
}

interface HeatmapWeek {
	cells: (HeatmapCell | null)[];
	monthLabel: string | null;
}

function intensityLevel(turns: number, max: number): number {
	if (turns === 0 || max === 0) {
		return 0;
	}
	const ratio = turns / max;
	if (ratio < 0.25) {
		return 1;
	}
	if (ratio < 0.5) {
		return 2;
	}
	if (ratio < 0.75) {
		return 3;
	}
	return 4;
}

function buildWeeks(daily: DayPoint[]): HeatmapWeek[] {
	const max = Math.max(1, ...daily.map((d) => d.turns));
	const weeks: HeatmapWeek[] = [];
	let currentWeek: HeatmapWeek = { cells: [], monthLabel: null };
	for (const point of daily) {
		const date = new Date(`${point.day}T00:00:00`);
		const dow = (date.getDay() + 6) % 7; // 0=Mon
		if (dow === 0 && currentWeek.cells.length > 0) {
			while (currentWeek.cells.length < 7) {
				currentWeek.cells.push(null);
			}
			weeks.push(currentWeek);
			currentWeek = { cells: [], monthLabel: null };
		}
		const monthIdx = date.getMonth();
		if (currentWeek.cells.length === 0) {
			currentWeek.monthLabel = MONTH_LABELS[monthIdx];
		}
		while (currentWeek.cells.length < dow) {
			currentWeek.cells.push(null);
		}
		currentWeek.cells.push({
			day: point.day,
			level: intensityLevel(point.turns, max),
			turns: point.turns,
		});
	}
	if (currentWeek.cells.length > 0) {
		weeks.push(currentWeek);
	}
	return weeks;
}

function HeatmapTooltip({
	cell,
	x,
	y,
}: {
	cell: HeatmapCell;
	x: number;
	y: number;
}) {
	const date = new Date(`${cell.day}T00:00:00`);
	const label = date.toLocaleDateString("en-US", {
		weekday: "short",
		month: "short",
		day: "numeric",
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

interface WeekCellProps {
	cell: HeatmapCell | null;
	di: number;
	palette: string[];
	setTooltip: (t: { cell: HeatmapCell; x: number; y: number } | null) => void;
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

function HeatmapGrid({
	palette,
	setTooltip,
	weeks,
}: {
	palette: string[];
	setTooltip: (t: { cell: HeatmapCell; x: number; y: number } | null) => void;
	weeks: HeatmapWeek[];
}) {
	return (
		<>
			{weeks.map((week, wi) => (
				<div className="flex flex-col gap-0.5" key={weekKey(wi)}>
					{week.monthLabel ? (
						<span className="mb-0.5 text-muted-foreground text-xs">
							{week.monthLabel}
						</span>
					) : (
						<span className="mb-0.5 text-xs">&nbsp;</span>
					)}
					{Array.from({ length: 7 }, (_, di) => (
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

function HeatmapLegend({ palette }: { palette: string[] }) {
	return (
		<div className="mt-3 flex items-center gap-2 text-muted-foreground text-xs">
			<span>Less</span>
			{palette.map((color, i) => (
				<div
					className="rounded-sm"
					key={legendKey(i)}
					style={{ backgroundColor: color, height: 11, width: 11 }}
				/>
			))}
			<span>More</span>
		</div>
	);
}

export function ActivityHeatmap({ daily }: { daily: DayPoint[] }) {
	const weeks = useMemo(() => buildWeeks(daily), [daily]);
	const [tooltip, setTooltip] = useState<{
		cell: HeatmapCell;
		x: number;
		y: number;
	} | null>(null);
	const isDark =
		typeof document !== "undefined" &&
		document.documentElement.classList.contains("dark");
	const palette = isDark ? LEVELS_DARK : LEVELS_LIGHT;
	if (daily.length === 0) {
		return null;
	}
	return (
		<div className="rounded-xl border bg-card p-4 shadow-sm">
			<p className="mb-3 font-medium text-sm">Activity</p>
			<div className="flex gap-1 overflow-x-auto">
				<div className="flex flex-col justify-around pr-1 text-muted-foreground text-xs">
					{DAY_LABELS.map((label) => (
						<span key={label} style={{ height: CELL_SIZE + CELL_GAP }}>
							{label}
						</span>
					))}
				</div>
				<HeatmapGrid palette={palette} setTooltip={setTooltip} weeks={weeks} />
			</div>
			<HeatmapLegend palette={palette} />
			{tooltip ? <HeatmapTooltip {...tooltip} /> : null}
		</div>
	);
}
