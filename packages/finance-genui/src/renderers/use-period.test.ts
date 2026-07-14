// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { expect, it } from "vitest";
import { usePeriod } from "./use-period";

const PERIODS = ["30d", "90d", "1Y"] as const;

it("defaults to the first period when no initial is given", () => {
	const { result } = renderHook(() => usePeriod(PERIODS));
	expect(result.current.period).toBe("30d");
	expect(result.current.periods).toEqual(["30d", "90d", "1Y"]);
});

it("honors an explicit initial period", () => {
	const { result } = renderHook(() => usePeriod(PERIODS, { initial: "1Y" }));
	expect(result.current.period).toBe("1Y");
});

it("setPeriod updates the active period", () => {
	const { result } = renderHook(() => usePeriod(PERIODS));
	act(() => result.current.setPeriod("90d"));
	expect(result.current.period).toBe("90d");
});

it("defaults isAvailable to always-true when not provided", () => {
	const { result } = renderHook(() => usePeriod(PERIODS));
	expect(result.current.isAvailable("1Y")).toBe(true);
});

it("passes through a caller-supplied isAvailable without fetching", () => {
	const isAvailable = (period: (typeof PERIODS)[number]) => period !== "1Y";
	const { result } = renderHook(() => usePeriod(PERIODS, { isAvailable }));
	expect(result.current.isAvailable("30d")).toBe(true);
	expect(result.current.isAvailable("1Y")).toBe(false);
});
