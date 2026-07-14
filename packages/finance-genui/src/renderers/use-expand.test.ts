// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { expect, it } from "vitest";
import { useExpand } from "./use-expand";

it("multi mode (default): toggles are independent", () => {
	const { result } = renderHook(() => useExpand());
	act(() => result.current.toggle("row-1"));
	act(() => result.current.toggle("row-2"));
	expect(result.current.expandedIds.sort()).toEqual(["row-1", "row-2"]);
	expect(result.current.isExpanded("row-1")).toBe(true);

	act(() => result.current.toggle("row-1"));
	expect(result.current.expandedIds).toEqual(["row-2"]);
});

it("single mode: opening one row closes the previously open row (accordion)", () => {
	const { result } = renderHook(() => useExpand({ mode: "single" }));
	act(() => result.current.toggle("row-1"));
	expect(result.current.expandedIds).toEqual(["row-1"]);

	act(() => result.current.toggle("row-2"));
	expect(result.current.expandedIds).toEqual(["row-2"]);
	expect(result.current.isExpanded("row-1")).toBe(false);
});

it("single mode: toggling the open row closes it", () => {
	const { result } = renderHook(() => useExpand({ mode: "single" }));
	act(() => result.current.toggle("row-1"));
	act(() => result.current.toggle("row-1"));
	expect(result.current.expandedIds).toEqual([]);
});

it("collapseAll clears expansion state in both modes", () => {
	const { result } = renderHook(() => useExpand());
	act(() => result.current.toggle("row-1"));
	act(() => result.current.toggle("row-2"));
	act(() => result.current.collapseAll());
	expect(result.current.expandedIds).toEqual([]);
});
