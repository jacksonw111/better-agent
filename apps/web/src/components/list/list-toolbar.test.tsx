// @vitest-environment jsdom
import { fireEvent, render, within } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { ListToolbar } from "./list-toolbar";

it("shows the placeholder, current search value, and the action slot", () => {
	const { container } = render(
		<ListToolbar
			action={<button type="button">Add agent</button>}
			onSearch={() => undefined}
			placeholder="Search agents…"
			search="foo"
		/>
	);
	const view = within(container);
	const input = view.getByPlaceholderText("Search agents…") as HTMLInputElement;
	expect(input.value).toBe("foo");
	expect(view.getByRole("button", { name: "Add agent" })).toBeDefined();
});

it("calls onSearch with the new value as the user types", () => {
	const onSearch = vi.fn();
	const { container } = render(
		<ListToolbar onSearch={onSearch} placeholder="Search…" search="" />
	);
	const input = within(container).getByPlaceholderText("Search…");
	fireEvent.change(input, { target: { value: "abc" } });
	expect(onSearch).toHaveBeenCalledWith("abc");
});
