// @vitest-environment jsdom
import { render, within } from "@testing-library/react";
import { PlugIcon } from "lucide-react";
import { expect, it } from "vitest";
import { EmptyState } from "./empty-state";

it("renders the title, and omits body/action/icon when not given", () => {
	const { container } = render(<EmptyState title="No memories yet" />);
	const view = within(container);
	expect(view.getByText("No memories yet")).toBeDefined();
	expect(container.querySelector("svg")).toBeNull();
});

it("renders body text, icon, and action when given", () => {
	const { container } = render(
		<EmptyState
			action={<button type="button">Add account</button>}
			body="Connect an account to get started."
			icon={PlugIcon}
			title="No integrations yet"
		/>
	);
	const view = within(container);
	expect(view.getByText("No integrations yet")).toBeDefined();
	expect(view.getByText("Connect an account to get started.")).toBeDefined();
	expect(view.getByRole("button", { name: "Add account" })).toBeDefined();
	expect(container.querySelector("svg")).not.toBeNull();
});
