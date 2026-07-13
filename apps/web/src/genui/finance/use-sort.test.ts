// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { expect, it } from "vitest";
import { useSort } from "./use-sort";

interface Row {
	id: string;
	value: number | null | undefined;
}

const ROWS: Row[] = [
	{ id: "a", value: 3 },
	{ id: "b", value: 10 },
	{ id: "c", value: Number.NaN },
	{ id: "d", value: null },
	{ id: "e", value: 3 },
	{ id: "f", value: undefined },
	{ id: "g", value: 2 },
];

it("sorts numbers numerically, not lexicographically", () => {
	const { result } = renderHook(() =>
		useSort<Row>(ROWS, { initialKey: "value" })
	);
	// initialKey alone already sorts desc (biggest first): 10 before 3, not
	// "10" < "3" lexicographically.
	const values = result.current.sorted.map((row) => row.value);
	expect(values.slice(0, 3)).toEqual([10, 3, 3]);
});

it("keeps null/undefined/NaN last regardless of direction", () => {
	const { result } = renderHook(() =>
		useSort<Row>(ROWS, { initialKey: "value" })
	);

	// desc (default)
	const descIds = result.current.sorted.map((row) => row.id);
	expect(descIds.slice(-3).sort()).toEqual(["c", "d", "f"]);

	// asc
	act(() => result.current.toggleSort("value"));
	const ascIds = result.current.sorted.map((row) => row.id);
	expect(ascIds.slice(-3).sort()).toEqual(["c", "d", "f"]);
});

it("is a stable sort: equal keys preserve original relative order", () => {
	const { result } = renderHook(() =>
		useSort<Row>(ROWS, { initialKey: "value" })
	);
	const equalValueIds = result.current.sorted
		.filter((row) => row.value === 3)
		.map((row) => row.id);
	expect(equalValueIds).toEqual(["a", "e"]);
});

it("toggleSort: new key defaults to desc, same key flips asc/desc", () => {
	const { result } = renderHook(() => useSort<Row>(ROWS));
	expect(result.current.sortDir).toBe("desc");

	act(() => result.current.toggleSort("value"));
	expect(result.current.sortKey).toBe("value");
	expect(result.current.sortDir).toBe("desc");

	act(() => result.current.toggleSort("value"));
	expect(result.current.sortDir).toBe("asc");

	act(() => result.current.toggleSort("value"));
	expect(result.current.sortDir).toBe("desc");

	act(() => result.current.toggleSort("id"));
	expect(result.current.sortKey).toBe("id");
	expect(result.current.sortDir).toBe("desc");
});

it("never mutates the input array", () => {
	const original = [...ROWS];
	const { result } = renderHook(() =>
		useSort<Row>(ROWS, { initialKey: "value" })
	);
	act(() => result.current.toggleSort("value"));
	expect(ROWS).toEqual(original);
});
