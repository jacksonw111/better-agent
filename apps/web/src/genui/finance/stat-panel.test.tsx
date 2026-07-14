// @vitest-environment jsdom
import { fireEvent, render, within } from "@testing-library/react";
import { expect, it } from "vitest";
import { StatPanel } from "./stat-panel";

it("renders every always-visible group without an Expand toggle when none is given", () => {
	const { container } = render(
		<StatPanel
			groups={[
				{ items: [{ label: "最新价", value: "10.00" }], label: "行情" },
				{ items: [{ label: "PE(TTM)", value: "12.3" }], label: "估值" },
			]}
			title="AAPL"
		/>
	);
	const scope = within(container);
	expect(scope.getByText("行情")).toBeDefined();
	expect(scope.getByText("最新价")).toBeDefined();
	expect(scope.getByText("估值")).toBeDefined();
	expect(scope.getByText("PE(TTM)")).toBeDefined();
	expect(scope.queryByRole("button")).toBeNull();
});

it("hides expandable content until the toggle is clicked, then reveals and re-hides it", () => {
	const { container } = render(
		<StatPanel
			expandable={{ content: <span>额外内容</span>, label: "规模 · 股本" }}
			groups={[{ items: [{ label: "总市值", value: "1.5万亿" }] }]}
			title="AAPL"
		/>
	);
	const scope = within(container);

	expect(scope.queryByText("额外内容")).toBeNull();
	const toggle = scope.getByText("展开规模 · 股本");
	expect(toggle.closest("button")?.getAttribute("aria-expanded")).toBe("false");

	fireEvent.click(toggle);
	expect(scope.getByText("额外内容")).toBeDefined();
	const collapse = scope.getByText("收起规模 · 股本");
	expect(collapse.closest("button")?.getAttribute("aria-expanded")).toBe(
		"true"
	);

	fireEvent.click(collapse);
	expect(scope.queryByText("额外内容")).toBeNull();
});

it("renders the header title/subtitle/right slot", () => {
	const { container } = render(
		<StatPanel
			groups={[]}
			right={<span>右侧</span>}
			subtitle="2024-01-01"
			title="AAPL"
		/>
	);
	const scope = within(container);
	expect(scope.getByText("AAPL")).toBeDefined();
	expect(scope.getByText("2024-01-01")).toBeDefined();
	expect(scope.getByText("右侧")).toBeDefined();
});
