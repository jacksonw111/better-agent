// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { expect, it } from "vitest";
import { useSeriesSelect } from "./use-series-select";

const METRIC_IDS = ["revenue", "net_income", "gross_margin"];

it("defaults to the min floor selected, in list order", () => {
	const { result } = renderHook(() => useSeriesSelect(METRIC_IDS, { min: 2 }));
	expect(result.current.selected).toEqual(["revenue", "net_income"]);
});

it("cannot deselect below the min floor (default 1)", () => {
	const { result } = renderHook(() => useSeriesSelect(METRIC_IDS));
	expect(result.current.selected).toEqual(["revenue"]);
	act(() => result.current.toggle("revenue"));
	// still selected: the only remaining metric can't be removed
	expect(result.current.selected).toEqual(["revenue"]);
});

it("cannot select beyond an optional max cap", () => {
	const { result } = renderHook(() =>
		useSeriesSelect(METRIC_IDS, { initial: ["revenue"], max: 2 })
	);
	act(() => result.current.toggle("net_income"));
	expect(result.current.selected).toEqual(["revenue", "net_income"]);
	act(() => result.current.toggle("gross_margin"));
	expect(result.current.selected).toEqual(["revenue", "net_income"]);
});

it("is order-stable: selection order reflects insertion, not list order", () => {
	const { result } = renderHook(() =>
		useSeriesSelect(METRIC_IDS, { initial: ["revenue"] })
	);
	act(() => result.current.toggle("gross_margin"));
	act(() => result.current.toggle("net_income"));
	expect(result.current.selected).toEqual([
		"revenue",
		"gross_margin",
		"net_income",
	]);

	act(() => result.current.toggle("gross_margin"));
	expect(result.current.selected).toEqual(["revenue", "net_income"]);
});

it("setSelected rejects sets that violate min/max, and dedupes", () => {
	const { result } = renderHook(() =>
		useSeriesSelect(METRIC_IDS, {
			initial: ["revenue", "net_income"],
			min: 1,
			max: 2,
		})
	);
	act(() => result.current.setSelected([]));
	expect(result.current.selected).toEqual(["revenue", "net_income"]);

	act(() =>
		result.current.setSelected(["revenue", "net_income", "gross_margin"])
	);
	expect(result.current.selected).toEqual(["revenue", "net_income"]);

	act(() => result.current.setSelected(["gross_margin", "gross_margin"]));
	expect(result.current.selected).toEqual(["gross_margin"]);
	expect(result.current.isSelected("gross_margin")).toBe(true);
});
