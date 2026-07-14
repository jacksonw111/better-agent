// @vitest-environment jsdom
import { cleanup, fireEvent, render, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { readSlashUsage } from "./slash-usage";
import { TerminalComposer } from "./terminal-composer";

// P2-T5: a picker SELECTION records a use (slash-usage.ts), and the next
// open sorts the picked item to the top of its group.

const COMMANDS = ["compact", "clear"];
const SKILLS = ["pdf"];

beforeEach(() => {
	localStorage.clear();
});
afterEach(cleanup);

function renderComposer() {
	const { container } = render(
		<TerminalComposer
			disabled={false}
			onSend={vi.fn()}
			sending={false}
			skills={SKILLS}
			slashCommands={COMMANDS}
		/>
	);
	const view = within(container);
	const textarea = view.getByLabelText("Message") as HTMLTextAreaElement;
	return { textarea, view };
}

it("records a use on selection and floats the item on the next open", () => {
	const { textarea, view } = renderComposer();

	fireEvent.change(textarea, { target: { value: "/" } });
	fireEvent.mouseDown(view.getByRole("option", { name: "clear" }));

	expect(readSlashUsage()).toEqual({ clear: 1 });
	expect(textarea.value).toBe("/clear ");

	fireEvent.change(textarea, { target: { value: "/" } });
	const names = view.getAllByRole("option").map((option) => option.textContent);
	expect(names).toEqual(["/clear", "/compact", "/pdf"]);
});

it("does not record a use for a name merely typed out by hand", () => {
	const { textarea } = renderComposer();

	fireEvent.change(textarea, { target: { value: "/clear" } });
	fireEvent.change(textarea, { target: { value: "/clear " } });

	expect(readSlashUsage()).toEqual({});
});
