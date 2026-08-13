// @vitest-environment jsdom
import { ChatComposer } from "@better-agent/ui/components/chat/chat-composer";
import { fireEvent, render, within } from "@testing-library/react";
import { expect, it, vi } from "vitest";

// Render-level test for the web chat composer's "/" skill picker (T5) —
// typing "/" filters, and selecting (by keyboard or click) inserts the token
// without sending.

const fakeAgentClient = {} as unknown as Parameters<
	typeof ChatComposer
>[0]["agentClient"];

const SKILLS = [
	{ name: "pdf", description: "Turn a page into a searchable PDF" },
	{ name: "compare-docs", description: "Diff two documents" },
];

function renderComposer(skills = SKILLS) {
	const onSend = vi.fn();
	const { container } = render(
		<ChatComposer
			agentClient={fakeAgentClient}
			onSend={onSend}
			onStop={vi.fn()}
			sessionId="s1"
			skills={skills}
			streaming={false}
		/>
	);
	const view = within(container);
	const textarea = view.getByLabelText("Message") as HTMLTextAreaElement;
	return { view, textarea, onSend };
}

it("opens the picker with the agent's assigned skills on a bare '/'", () => {
	const { view, textarea } = renderComposer();

	fireEvent.change(textarea, { target: { value: "/" } });

	expect(view.getByRole("listbox")).toBeDefined();
	expect(view.getByRole("option", { name: "pdf" })).toBeDefined();
	expect(view.getByRole("option", { name: "compare-docs" })).toBeDefined();
	expect(view.getByText("Turn a page into a searchable PDF")).toBeDefined();
});

it("filters to matching skills as the query narrows", () => {
	const { view, textarea } = renderComposer();

	fireEvent.change(textarea, { target: { value: "/pd" } });

	expect(view.getByRole("option", { name: "pdf" })).toBeDefined();
	expect(view.queryByRole("option", { name: "compare-docs" })).toBeNull();
});

it("does not open for a slash typed mid-message", () => {
	const { view, textarea } = renderComposer();

	fireEvent.change(textarea, { target: { value: "fix this /pd" } });

	expect(view.queryByRole("listbox")).toBeNull();
});

it("moves the highlight with arrow keys and Enter fills the box without sending", () => {
	const { view, textarea, onSend } = renderComposer();

	fireEvent.change(textarea, { target: { value: "/" } });
	fireEvent.keyDown(textarea, { key: "ArrowDown" });
	fireEvent.keyDown(textarea, { key: "Enter" });

	expect(textarea.value).toBe("/compare-docs ");
	expect(onSend).not.toHaveBeenCalled();
	expect(view.queryByRole("listbox")).toBeNull();
});

it("selecting by click also just fills the box", () => {
	const { view, textarea, onSend } = renderComposer();

	fireEvent.change(textarea, { target: { value: "/pd" } });
	fireEvent.mouseDown(view.getByRole("option", { name: "pdf" }));

	expect(textarea.value).toBe("/pdf ");
	expect(onSend).not.toHaveBeenCalled();
});

it("Escape clears the in-progress slash entry and closes the picker", () => {
	const { view, textarea } = renderComposer();

	fireEvent.change(textarea, { target: { value: "/pd" } });
	fireEvent.keyDown(textarea, { key: "Escape" });

	expect(textarea.value).toBe("");
	expect(view.queryByRole("listbox")).toBeNull();
});

it("shows no picker when the agent has no assigned skills", () => {
	const { view, textarea } = renderComposer([]);

	fireEvent.change(textarea, { target: { value: "/" } });

	expect(view.queryByRole("listbox")).toBeNull();
});

it("still sends a plain (non-slash) message normally", () => {
	const { textarea, onSend } = renderComposer();

	fireEvent.change(textarea, { target: { value: "hello agent" } });
	fireEvent.keyDown(textarea, { key: "Enter" });

	expect(onSend).toHaveBeenCalledWith("hello agent", []);
});
