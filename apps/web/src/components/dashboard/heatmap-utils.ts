// apps/web/src/components/dashboard/heatmap-utils.ts
//
// Pure helpers behind the GitHub-style activity heatmap: building the wide
// day axis, merging the sparse API rows onto it, mapping values to intensity
// levels, and grouping days into week columns with month labels. Kept
// side-effect free and framework-free so they're cheap to unit test.

const MS_PER_DAY = 86_400_000;
const ISO_DATE_LENGTH = 10;
const DAYS_PER_WEEK = 7;

/** Max window the `usage.dailyActivity` query accepts (see packages/api's
 * `MAX_DAILY_ACTIVITY_DAYS`) — ~26 week-columns, a real GitHub-style span.
 * Deliberately independent of the token chart's 3/7/12 `window-toggle`. */
export const HEATMAP_WINDOW_DAYS = 180;

// GitHub-style 5-level intensity palette — mirrors TokenTracker's
// ActivityHeatmap (ebedf0 → 10b981 in light, 30363d → 34d399 in dark).
export const LEVELS_LIGHT = [
	"#ebedf0",
	"#a7f3d0",
	"#6ee7b7",
	"#34d399",
	"#10b981",
];
export const LEVELS_DARK = [
	"#30363d",
	"#065f46",
	"#059669",
	"#10b981",
	"#34d399",
];

// Single source of truth for cell size + gap. Both the grid's week columns
// and the day-of-week label column read these two numbers (via inline
// `style`, not a Tailwind utility class) so their row pitch can never drift
// apart — that drift was the root cause of the label misalignment bug.
export const CELL_SIZE = 13; // px, square cell edge
export const CELL_GAP = 2; // px, gap between stacked cells/labels

export const MONTH_LABELS = [
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
] as const;

// Mon-first day-of-week labels, one entry per grid row (index 0 = Mon ... 6 =
// Sun); `null` rows render a blank space so the label column stays exactly
// 7 rows tall, matching the grid.
export const DAY_LABEL_ROWS: readonly (string | null)[] = [
	"Mon",
	null,
	"Wed",
	null,
	"Fri",
	null,
	null,
];

export interface HeatmapDayPoint {
	day: string; // "YYYY-MM-DD", UTC
	totalTokens: number;
	turns: number;
}

export interface HeatmapCell {
	day: string;
	level: number;
	turns: number;
}

export interface HeatmapWeek {
	cells: (HeatmapCell | null)[];
	monthLabel: string | null;
}

/** Build a continuous UTC day axis of `windowDays` days ending today
 * (inclusive), "YYYY-MM-DD" ascending. Mirrors `use-usage-data.ts`'s
 * `buildDayAxis`, sized for the heatmap's own (wider, decoupled) window. */
export function buildHeatmapDayAxis(
	windowDays: number,
	now: Date = new Date()
): string[] {
	return Array.from({ length: windowDays }, (_, i) => {
		const d = new Date(now.getTime() - (windowDays - 1 - i) * MS_PER_DAY);
		return d.toISOString().slice(0, ISO_DATE_LENGTH);
	});
}

/** Map sparse `usage.dailyActivity` rows onto the continuous axis; days with
 * no activity get zeros. Mirrors `use-usage-data.ts`'s `mergeDays`. */
export function mergeHeatmapDays(
	axis: string[],
	rows: HeatmapDayPoint[]
): HeatmapDayPoint[] {
	const byDay = new Map(rows.map((r) => [r.day, r]));
	return axis.map((day) => byDay.get(day) ?? { day, totalTokens: 0, turns: 0 });
}

/** Parse a "YYYY-MM-DD" (UTC) day string as a UTC midnight `Date`. Using `Z`
 * (not local-time parsing) keeps day-of-week/month math correct for users
 * whose local timezone would otherwise shift the calendar day. */
export function parseUtcDay(day: string): Date {
	return new Date(`${day}T00:00:00Z`);
}

/**
 * Per-day activity value used for cell intensity. `turns` (assistant
 * reply count) rather than `totalTokens`: turns behaves like a GitHub commit
 * count — a steady, comparable signal day to day — while raw token volume
 * can spike by orders of magnitude on a single long response and would
 * flatten every other day to the lowest level by comparison.
 */
export function heatmapValue(point: HeatmapDayPoint): number {
	return point.turns;
}

const RATIO_LOW = 0.25;
const RATIO_MID = 0.5;
const RATIO_HIGH = 0.75;

export function intensityLevel(value: number, max: number): number {
	if (value <= 0 || max <= 0) {
		return 0;
	}
	const ratio = value / max;
	if (ratio < RATIO_LOW) {
		return 1;
	}
	if (ratio < RATIO_MID) {
		return 2;
	}
	if (ratio < RATIO_HIGH) {
		return 3;
	}
	return 4;
}

function dayOfWeekMonFirst(date: Date): number {
	return (date.getUTCDay() + 6) % 7;
}

/**
 * Group a continuous (zero-padded) day axis into GitHub-style week columns,
 * Mon-first. A week's `monthLabel` is only set when the month differs from
 * the last month a label was assigned — never unconditionally per week — so
 * a month name shows once at its first column instead of repeating down
 * every week column it spans.
 */
export function buildWeeks(
	daily: HeatmapDayPoint[],
	getValue: (p: HeatmapDayPoint) => number = heatmapValue
): HeatmapWeek[] {
	const max = Math.max(1, ...daily.map(getValue));
	const weeks: HeatmapWeek[] = [];
	let currentWeek: HeatmapWeek = { cells: [], monthLabel: null };
	let lastLabeledMonth = -1;

	for (const point of daily) {
		const date = parseUtcDay(point.day);
		const dow = dayOfWeekMonFirst(date);
		if (dow === 0 && currentWeek.cells.length > 0) {
			weeks.push(currentWeek);
			currentWeek = { cells: [], monthLabel: null };
		}
		const monthIdx = date.getUTCMonth();
		if (currentWeek.cells.length === 0 && monthIdx !== lastLabeledMonth) {
			currentWeek.monthLabel = MONTH_LABELS[monthIdx];
			lastLabeledMonth = monthIdx;
		}
		while (currentWeek.cells.length < dow) {
			currentWeek.cells.push(null);
		}
		currentWeek.cells.push({
			day: point.day,
			level: intensityLevel(getValue(point), max),
			turns: point.turns,
		});
	}
	if (currentWeek.cells.length > 0) {
		weeks.push(currentWeek);
	}
	return weeks;
}

export const HEATMAP_DAYS_PER_WEEK = DAYS_PER_WEEK;
