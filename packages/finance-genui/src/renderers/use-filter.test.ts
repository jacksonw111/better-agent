// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { expect, it } from "vitest";
import type { FilterOption } from "./use-filter";
import { useFilter } from "./use-filter";

interface Row {
	id: string;
	side: "buy" | "sell";
	tier: "huge" | "large" | "mid" | "small";
}

const ROWS: Row[] = [
	{ id: "1", side: "buy", tier: "huge" },
	{ id: "2", side: "sell", tier: "large" },
	{ id: "3", side: "buy", tier: "mid" },
	{ id: "4", side: "sell", tier: "small" },
];

const SIDE_OPTIONS: FilterOption<Row>[] = [
	{ id: "buy", predicate: (row) => row.side === "buy" },
	{ id: "sell", predicate: (row) => row.side === "sell" },
];

const TIER_OPTIONS: FilterOption<Row>[] = [
	{ id: "huge", predicate: (row) => row.tier === "huge" },
	{ id: "large", predicate: (row) => row.tier === "large" },
	{ id: "mid", predicate: (row) => row.tier === "mid" },
	{ id: "small", predicate: (row) => row.tier === "small" },
];

it("single mode: no active id returns all rows (the 'all' default)", () => {
	const { result } = renderHook(() =>
		useFilter(ROWS, SIDE_OPTIONS, { mode: "single" })
	);
	expect(result.current.filtered).toHaveLength(4);
	expect(result.current.activeIds).toEqual([]);
});

it("single mode: toggling selects one option, and only one at a time", () => {
	const { result } = renderHook(() =>
		useFilter(ROWS, SIDE_OPTIONS, { mode: "single" })
	);
	act(() => result.current.toggle("buy"));
	expect(result.current.activeIds).toEqual(["buy"]);
	expect(result.current.filtered.map((row) => row.id)).toEqual(["1", "3"]);

	act(() => result.current.toggle("sell"));
	expect(result.current.activeIds).toEqual(["sell"]);
	expect(result.current.filtered.map((row) => row.id)).toEqual(["2", "4"]);

	// toggling the active option off returns to the "all" default
	act(() => result.current.toggle("sell"));
	expect(result.current.activeIds).toEqual([]);
	expect(result.current.filtered).toHaveLength(4);
});

it("multi mode: independently toggles multiple options on and off", () => {
	const { result } = renderHook(() =>
		useFilter(ROWS, TIER_OPTIONS, { mode: "multi" })
	);
	act(() => result.current.toggle("huge"));
	act(() => result.current.toggle("large"));
	expect(result.current.activeIds.sort()).toEqual(["huge", "large"]);
	expect(result.current.filtered.map((row) => row.id).sort()).toEqual([
		"1",
		"2",
	]);

	act(() => result.current.toggle("huge"));
	expect(result.current.activeIds).toEqual(["large"]);
	expect(result.current.filtered.map((row) => row.id)).toEqual(["2"]);
});

it("multi mode: empty active set falls through to all rows", () => {
	const { result } = renderHook(() =>
		useFilter(ROWS, TIER_OPTIONS, { mode: "multi" })
	);
	expect(result.current.filtered).toHaveLength(4);
	act(() => result.current.toggle("huge"));
	act(() => result.current.toggle("huge"));
	expect(result.current.activeIds).toEqual([]);
	expect(result.current.filtered).toHaveLength(4);
});

it("setActive forces a single explicit selection and clear() resets", () => {
	const { result } = renderHook(() =>
		useFilter(ROWS, TIER_OPTIONS, { mode: "multi" })
	);
	act(() => result.current.setActive("mid"));
	expect(result.current.activeIds).toEqual(["mid"]);
	expect(result.current.isActive("mid")).toBe(true);
	expect(result.current.isActive("huge")).toBe(false);

	act(() => result.current.clear());
	expect(result.current.activeIds).toEqual([]);
	expect(result.current.filtered).toHaveLength(4);
});

it("never mutates the input rows array", () => {
	const original = [...ROWS];
	const { result } = renderHook(() =>
		useFilter(ROWS, SIDE_OPTIONS, { mode: "single" })
	);
	act(() => result.current.toggle("buy"));
	expect(ROWS).toEqual(original);
});
