// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { expect, it } from "vitest";
import { usePivot } from "./use-pivot";

it("defaults to the table view", () => {
	const { result } = renderHook(() => usePivot());
	expect(result.current.view).toBe("table");
});

it("honors an explicit initial view", () => {
	const { result } = renderHook(() => usePivot({ initial: "chart" }));
	expect(result.current.view).toBe("chart");
});

it("toggle swaps between table and chart", () => {
	const { result } = renderHook(() => usePivot());
	act(() => result.current.toggle());
	expect(result.current.view).toBe("chart");
	act(() => result.current.toggle());
	expect(result.current.view).toBe("table");
});

it("setView sets the view directly", () => {
	const { result } = renderHook(() => usePivot());
	act(() => result.current.setView("chart"));
	expect(result.current.view).toBe("chart");
});
