// apps/web/src/components/dashboard/heatmap-utils.test.ts

import { expect, it } from "vitest";
import {
	buildHeatmapDayAxis,
	buildWeeks,
	type HeatmapDayPoint,
	intensityLevel,
	mergeHeatmapDays,
} from "./heatmap-utils";

const NOW = new Date("2026-07-08T12:00:00Z");

function point(day: string, turns = 0, totalTokens = 0): HeatmapDayPoint {
	return { day, totalTokens, turns };
}

it("buildHeatmapDayAxis returns N ascending UTC days ending today, none in the future", () => {
	const axis = buildHeatmapDayAxis(180, NOW);
	expect(axis).toHaveLength(180);
	expect(axis.at(-1)).toBe("2026-07-08");
	expect(axis.at(0)).toBe("2026-01-10");
	for (let i = 1; i < axis.length; i++) {
		expect(axis[i] > axis[i - 1]).toBe(true);
	}
	for (const day of axis) {
		expect(day <= "2026-07-08").toBe(true);
	}
});

it("mergeHeatmapDays fills gaps with zeros and keeps axis order", () => {
	const axis = buildHeatmapDayAxis(5, new Date("2026-01-05T00:00:00Z"));
	const rows = [point("2026-01-03", 4, 100), point("2026-01-05", 1, 10)];
	const merged = mergeHeatmapDays(axis, rows);
	expect(merged.map((d) => d.day)).toEqual(axis);
	expect(merged.map((d) => d.turns)).toEqual([0, 0, 4, 0, 1]);
	expect(merged.find((d) => d.day === "2026-01-05")?.totalTokens).toBe(10);
});

it("intensityLevel maps zero/max to level 0 and buckets the rest into 1-4", () => {
	expect(intensityLevel(0, 10)).toBe(0);
	expect(intensityLevel(5, 0)).toBe(0);
	expect(intensityLevel(1, 10)).toBe(1); // ratio 0.1 < 0.25
	expect(intensityLevel(3, 10)).toBe(2); // ratio 0.3 < 0.5
	expect(intensityLevel(6, 10)).toBe(3); // ratio 0.6 < 0.75
	expect(intensityLevel(9, 10)).toBe(4); // ratio 0.9
	expect(intensityLevel(10, 10)).toBe(4); // ratio 1.0
});

it("buildWeeks groups a continuous axis into Mon-first week columns, padding the first week", () => {
	// 2026-01-05 is a Monday; 2026-01-01 is a Thursday.
	const axis = buildHeatmapDayAxis(5, new Date("2026-01-05T00:00:00Z"));
	const daily = mergeHeatmapDays(axis, []);
	const weeks = buildWeeks(daily);
	expect(weeks).toHaveLength(2);
	// First (partial) week: Thu Jan1 .. Sun Jan4 -> 3 leading nulls, 4 cells.
	expect(weeks[0].cells).toHaveLength(7);
	expect(weeks[0].cells.slice(0, 3)).toEqual([null, null, null]);
	expect(weeks[0].cells[3]?.day).toBe("2026-01-01");
	// Second week starts Monday Jan5.
	expect(weeks[1].cells[0]?.day).toBe("2026-01-05");
});

it("buildWeeks sets monthLabel once at a month's first column, not on every week", () => {
	// Jan 26 2026 is a Monday; span 4 weeks to land solidly in February.
	const axis = buildHeatmapDayAxis(28, new Date("2026-02-22T00:00:00Z"));
	const daily = mergeHeatmapDays(axis, []);
	const weeks = buildWeeks(daily);
	const labels = weeks.map((w) => w.monthLabel);
	// Exactly one "Jan" and one "Feb" label, not one per week.
	expect(labels.filter((l) => l === "Jan")).toHaveLength(1);
	expect(labels.filter((l) => l === "Feb")).toHaveLength(1);
});

it("buildWeeks scales intensity level relative to the max value in the set", () => {
	const daily: HeatmapDayPoint[] = [
		point("2026-01-05", 0),
		point("2026-01-06", 10),
	];
	const weeks = buildWeeks(daily);
	const cells = weeks.flatMap((w) => w.cells).filter(Boolean);
	expect(cells.find((c) => c?.day === "2026-01-05")?.level).toBe(0);
	expect(cells.find((c) => c?.day === "2026-01-06")?.level).toBe(4);
});
