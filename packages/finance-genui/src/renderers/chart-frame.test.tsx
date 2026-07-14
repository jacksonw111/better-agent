// @vitest-environment jsdom
import { render, within } from "@testing-library/react";
import { expect, it } from "vitest";
import { ChartFrame } from "./chart-frame";

// Scoped to `within(container)` (not the default document.body-bound
// getByText) so repeated `render()` calls across `it()` blocks in this file
// never leak DOM from a prior test into a later assertion — follows
// option-chain.test.tsx's convention.

it("renders children when neither loading nor empty", () => {
	const { container } = render(
		<ChartFrame>
			<div>chart contents</div>
		</ChartFrame>
	);
	const scope = within(container);
	expect(scope.getByText("chart contents")).toBeDefined();
	expect(scope.queryByText("暂无数据")).toBeNull();
});

it("renders the empty placeholder instead of children when empty", () => {
	const { container } = render(
		<ChartFrame empty>
			<div>chart contents</div>
		</ChartFrame>
	);
	const scope = within(container);
	expect(scope.getByText("暂无数据")).toBeDefined();
	expect(scope.queryByText("chart contents")).toBeNull();
});

it("honors a custom emptyLabel", () => {
	const { container } = render(
		<ChartFrame empty emptyLabel="暂无 K线数据">
			<div>chart contents</div>
		</ChartFrame>
	);
	expect(within(container).getByText("暂无 K线数据")).toBeDefined();
});

it("renders the loading placeholder instead of children when loading", () => {
	const { container } = render(
		<ChartFrame loading>
			<div>chart contents</div>
		</ChartFrame>
	);
	const scope = within(container);
	expect(scope.getByText("加载中…")).toBeDefined();
	expect(scope.queryByText("chart contents")).toBeNull();
});
