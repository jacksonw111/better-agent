// @vitest-environment jsdom
import { fireEvent, render, within } from "@testing-library/react";
import { expect, it } from "vitest";
import type { KeyMetricsData } from "./finance-schemas";
import { KeyMetricsCard } from "./key-metrics-card";

const BASE: KeyMetricsData = {
	changePct: 1.24,
	close: 189.5,
	floatMarketCap: 2_900_000_000_000,
	floatShares: 15_000_000_000,
	marketCap: 3_000_000_000_000,
	pb: 45.2,
	pcf: 25.1,
	peStatic: 32.5,
	peTtm: 30.1,
	peg: 2.3,
	ps: 8.4,
	symbol: "AAPL",
	totalShares: 15_500_000_000,
	tradeDate: "2024-01-15",
};

it("shows 行情/估值 always-visible and keeps 规模·股本 behind Expand until toggled", () => {
	const { container } = render(<KeyMetricsCard data={BASE} />);
	const scope = within(container);

	expect(scope.getByText("AAPL")).toBeDefined();
	expect(scope.getByText("行情")).toBeDefined();
	expect(scope.getByText("估值")).toBeDefined();
	expect(scope.getByText("PE(TTM)")).toBeDefined();
	expect(scope.queryByText("总市值")).toBeNull();

	const toggle = scope.getByText("展开规模 · 股本");
	fireEvent.click(toggle);

	expect(scope.getByText("总市值")).toBeDefined();
	expect(scope.getByText("流通股")).toBeDefined();
});

it("colors 最新价 by tone and formats large market-cap figures with the 万亿/亿 compact scale", () => {
	const { container } = render(<KeyMetricsCard data={BASE} />);
	const scope = within(container);
	fireEvent.click(scope.getByText("展开规模 · 股本"));

	expect(scope.getByText("¥3.00万亿")).toBeDefined();
	expect(scope.getByText("+1.24%")).toBeDefined();
});
