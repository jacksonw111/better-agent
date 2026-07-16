import { expect, it } from "vitest";
import { groupByDay } from "./date-groups";

const NOW = new Date(2026, 6, 16, 12, 0, 0);

const at = (year: number, month: number, day: number, hour = 9) =>
	new Date(year, month, day, hour);

it("buckets newest-first items into Today/Yesterday/dated groups", () => {
	const items = [
		{ id: "a", createdAt: at(2026, 6, 16, 11) },
		{ id: "b", createdAt: at(2026, 6, 16, 8) },
		{ id: "c", createdAt: at(2026, 6, 15) },
		{ id: "d", createdAt: at(2026, 5, 30) },
	];

	const groups = groupByDay(items, (item) => item.createdAt, NOW);

	expect(groups.map((group) => group.label)).toEqual([
		"Today",
		"Yesterday",
		groups[2]?.label ?? "",
	]);
	expect(groups[2]?.label).not.toBe("Today");
	expect(groups[2]?.label).not.toBe("Yesterday");
	expect(groups.map((group) => group.items.map((item) => item.id))).toEqual([
		["a", "b"],
		["c"],
		["d"],
	]);
});

it("returns no groups for no items", () => {
	expect(groupByDay([], () => NOW, NOW)).toEqual([]);
});

it("splits items on calendar day, not 24h distance", () => {
	const items = [
		{ id: "late", createdAt: at(2026, 6, 16, 0) },
		{ id: "early", createdAt: at(2026, 6, 15, 23) },
	];

	const groups = groupByDay(items, (item) => item.createdAt, NOW);

	expect(groups).toHaveLength(2);
	expect(groups[0]?.label).toBe("Today");
	expect(groups[1]?.label).toBe("Yesterday");
});
