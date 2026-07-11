// @vitest-environment jsdom
import {
	act,
	fireEvent,
	render,
	waitFor,
	within,
} from "@testing-library/react";
import { expect, it, vi } from "vitest";
import type { TextWhen } from "./agent-capabilities";
import { TerminalComposer } from "./terminal-composer";
import { pickSelectOption } from "./terminal-test-helpers";

const COMMANDS = ["compact", "clear"];
const SKILLS = ["pdf"];
const ALL_BUSY_MODES: TextWhen[] = ["queue", "steer", "interrupt"];

it("opens the picker with the session's commands and skills on a bare '/'", () => {
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

	fireEvent.change(textarea, { target: { value: "/" } });

	expect(view.getByRole("listbox")).toBeDefined();
	expect(view.getByText("Commands")).toBeDefined();
	expect(view.getByText("Skills")).toBeDefined();
	expect(view.getByRole("option", { name: "compact" })).toBeDefined();
	expect(view.getByRole("option", { name: "clear" })).toBeDefined();
	expect(view.getByRole("option", { name: "pdf" })).toBeDefined();
});

it("filters to matching commands/skills as the query narrows", () => {
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

	fireEvent.change(textarea, { target: { value: "/co" } });

	expect(view.getByRole("option", { name: "compact" })).toBeDefined();
	expect(view.queryByRole("option", { name: "clear" })).toBeNull();
	expect(view.queryByRole("option", { name: "pdf" })).toBeNull();
});

it("moves the highlight with arrow keys and Enter fills the box without sending", () => {
	const onSend = vi.fn();
	const { container } = render(
		<TerminalComposer
			disabled={false}
			onSend={onSend}
			sending={false}
			skills={SKILLS}
			slashCommands={COMMANDS}
		/>
	);
	const view = within(container);
	const textarea = view.getByLabelText("Message") as HTMLTextAreaElement;

	fireEvent.change(textarea, { target: { value: "/" } });
	fireEvent.keyDown(textarea, { key: "ArrowDown" });
	fireEvent.keyDown(textarea, { key: "Enter" });

	expect(textarea.value).toBe("/clear ");
	expect(onSend).not.toHaveBeenCalled();
	expect(view.queryByRole("listbox")).toBeNull();
});

it("selecting by click also just fills the box", () => {
	const onSend = vi.fn();
	const { container } = render(
		<TerminalComposer
			disabled={false}
			onSend={onSend}
			sending={false}
			skills={SKILLS}
			slashCommands={COMMANDS}
		/>
	);
	const view = within(container);
	const textarea = view.getByLabelText("Message") as HTMLTextAreaElement;

	fireEvent.change(textarea, { target: { value: "/pd" } });
	fireEvent.mouseDown(view.getByRole("option", { name: "pdf" }));

	expect(textarea.value).toBe("/pdf ");
	expect(onSend).not.toHaveBeenCalled();
});

it("Escape clears the in-progress slash entry and closes the picker", () => {
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

	fireEvent.change(textarea, { target: { value: "/co" } });
	fireEvent.keyDown(textarea, { key: "Escape" });

	expect(textarea.value).toBe("");
	expect(view.queryByRole("listbox")).toBeNull();
});

it("shows no picker when the session hasn't reported any commands/skills", () => {
	const { container } = render(
		<TerminalComposer disabled={false} onSend={vi.fn()} sending={false} />
	);
	const view = within(container);
	const textarea = view.getByLabelText("Message") as HTMLTextAreaElement;

	fireEvent.change(textarea, { target: { value: "/" } });

	expect(view.queryByRole("listbox")).toBeNull();
});

it("still sends a plain (non-slash) message normally", () => {
	const onSend = vi.fn();
	const { container } = render(
		<TerminalComposer
			disabled={false}
			onSend={onSend}
			sending={false}
			skills={SKILLS}
			slashCommands={COMMANDS}
		/>
	);
	const view = within(container);
	const textarea = view.getByLabelText("Message") as HTMLTextAreaElement;

	fireEvent.change(textarea, { target: { value: "hello agent" } });
	fireEvent.keyDown(textarea, { key: "Enter" });

	expect(onSend).toHaveBeenCalledWith("hello agent");
});

// R3-T1 Part A: the busy-input hint row only earns its keep once there's
// actually a turn in flight AND more than one send policy to choose between —
// a single busyMode leaves nothing to pick, so the plain Send affordance
// covers it.
it("shows no busy-input hint when no turn is in flight", () => {
	const { container } = render(
		<TerminalComposer
			busyModes={ALL_BUSY_MODES}
			disabled={false}
			onSend={vi.fn()}
			sending={false}
			turnInFlight={false}
		/>
	);

	expect(within(container).queryByText("agent 正在工作 — 回车将")).toBeNull();
});

it("shows no busy-input hint when the agent only supports the bare queue default", () => {
	const { container } = render(
		<TerminalComposer
			busyModes={["queue"]}
			disabled={false}
			onSend={vi.fn()}
			sending={false}
			turnInFlight={true}
		/>
	);

	expect(within(container).queryByText("agent 正在工作 — 回车将")).toBeNull();
});

it("shows the busy-input hint with a mode picker offering all three modes, once a turn is in flight", async () => {
	const { container } = render(
		<TerminalComposer
			busyModes={ALL_BUSY_MODES}
			disabled={false}
			onSend={vi.fn()}
			sending={false}
			turnInFlight={true}
		/>
	);
	const view = within(container);

	expect(view.getByText("agent 正在工作 — 回车将")).toBeDefined();
	const trigger = view.getByRole("combobox", { name: "发送方式" });

	await act(() => {
		fireEvent.pointerDown(trigger, { button: 0, pointerId: 1 });
		fireEvent.click(trigger);
	});
	const body = within(document.body);
	await waitFor(() => {
		expect(body.getByRole("option", { name: "排队" })).toBeDefined();
	});
	expect(body.getByRole("option", { name: "插话" })).toBeDefined();
	expect(body.getByRole("option", { name: "打断后发送" })).toBeDefined();
});

it("rides the picked mode on the send payload, then resets back to queue for the next send", async () => {
	const onSend = vi.fn();
	const { container } = render(
		<TerminalComposer
			busyModes={ALL_BUSY_MODES}
			disabled={false}
			onSend={onSend}
			sending={false}
			turnInFlight={true}
		/>
	);
	const view = within(container);
	const textarea = view.getByLabelText("Message") as HTMLTextAreaElement;

	await pickSelectOption(container, "发送方式", "插话");
	fireEvent.change(textarea, { target: { value: "steer this" } });
	fireEvent.keyDown(textarea, { key: "Enter" });

	expect(onSend).toHaveBeenCalledWith("steer this", "steer");

	// Reset to queue after the send — "don't persist a sticky 'interrupt'".
	fireEvent.change(textarea, { target: { value: "second message" } });
	fireEvent.keyDown(textarea, { key: "Enter" });

	expect(onSend).toHaveBeenCalledWith("second message");
});

it("shows the queued-count chip only once queuedCount is positive", () => {
	const { container, rerender } = render(
		<TerminalComposer
			busyModes={ALL_BUSY_MODES}
			disabled={false}
			onSend={vi.fn()}
			queuedCount={null}
			sending={false}
			turnInFlight={true}
		/>
	);
	expect(within(container).queryByText("已排队 2 条")).toBeNull();

	rerender(
		<TerminalComposer
			busyModes={ALL_BUSY_MODES}
			disabled={false}
			onSend={vi.fn()}
			queuedCount={2}
			sending={false}
			turnInFlight={true}
		/>
	);
	expect(within(container).getByText("已排队 2 条")).toBeDefined();
});
