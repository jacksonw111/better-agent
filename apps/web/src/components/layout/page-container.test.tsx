// @vitest-environment jsdom
import { render, within } from "@testing-library/react";
import { expect, it } from "vitest";
import { PageContainer } from "./page-container";

it("renders children inside the capped, padded shell", () => {
	const { container } = render(
		<PageContainer>
			<p>Body content</p>
		</PageContainer>
	);
	const view = within(container);
	expect(view.getByText("Body content")).toBeDefined();
	const shell = container.firstElementChild as HTMLElement;
	expect(shell.className).toContain("max-w-5xl");
	expect(shell.className).toContain("mx-auto");
});

it("omits the title row when no title is given", () => {
	const { container } = render(
		<PageContainer>
			<p>Body content</p>
		</PageContainer>
	);
	expect(container.querySelector("h1")).toBeNull();
});

it("renders a title row with actions when a title is given", () => {
	const { container } = render(
		<PageContainer actions={<button type="button">Add</button>} title="Agents">
			<p>Body content</p>
		</PageContainer>
	);
	const view = within(container);
	expect(view.getByRole("heading", { level: 1, name: "Agents" })).toBeDefined();
	expect(view.getByRole("button", { name: "Add" })).toBeDefined();
});
