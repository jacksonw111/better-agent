// @vitest-environment jsdom
import { cleanup, fireEvent, render, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { setClientPref } from "@/utils/preferences";
import { TerminalComposer } from "./terminal-composer";

// P2-T4: the sendByCtrlEnter pref, LOCAL composer only — plain Enter becomes
// a newline (the shared textarea's Enter-to-submit is skipped WITHOUT
// preventDefault, so the browser inserts the newline) and Ctrl/Cmd+Enter
// submits. `fireEvent.*` returns false when the event was defaultPrevented,
// which is how the newline-vs-submit split is asserted here.

afterEach(() => {
	cleanup();
	window.localStorage.clear();
});

function setup() {
	const onSend = vi.fn();
	const { container } = render(
		<TerminalComposer
			disabled={false}
			onSend={onSend}
			sending={false}
			slashCommands={["clear"]}
		/>
	);
	const textarea = within(container).getByLabelText(
		"Message"
	) as HTMLTextAreaElement;
	return { onSend, textarea };
}

it("keeps plain Enter submitting while the pref is off (default)", () => {
	const { onSend, textarea } = setup();
	fireEvent.change(textarea, { target: { value: "hello" } });
	const notCancelled = fireEvent.keyDown(textarea, { key: "Enter" });
	expect(onSend).toHaveBeenCalledWith("hello");
	expect(notCancelled).toBe(false);
});

it("with the pref on, plain Enter no longer submits (newline runs instead)", () => {
	setClientPref("sendByCtrlEnter", true);
	const { onSend, textarea } = setup();
	fireEvent.change(textarea, { target: { value: "hello" } });
	const notCancelled = fireEvent.keyDown(textarea, { key: "Enter" });
	expect(onSend).not.toHaveBeenCalled();
	// Not defaultPrevented: the browser's native newline insertion proceeds.
	expect(notCancelled).toBe(true);
});

it("with the pref on, Ctrl+Enter submits", () => {
	setClientPref("sendByCtrlEnter", true);
	const { onSend, textarea } = setup();
	fireEvent.change(textarea, { target: { value: "hello" } });
	fireEvent.keyDown(textarea, { key: "Enter", ctrlKey: true });
	expect(onSend).toHaveBeenCalledWith("hello");
});

it("with the pref on, Cmd+Enter also submits", () => {
	setClientPref("sendByCtrlEnter", true);
	const { onSend, textarea } = setup();
	fireEvent.change(textarea, { target: { value: "hello" } });
	fireEvent.keyDown(textarea, { key: "Enter", metaKey: true });
	expect(onSend).toHaveBeenCalledWith("hello");
});

it("an open slash picker's Enter still selects (picker precedence)", () => {
	setClientPref("sendByCtrlEnter", true);
	const { onSend, textarea } = setup();
	fireEvent.change(textarea, { target: { value: "/cl" } });
	fireEvent.keyDown(textarea, { key: "Enter" });
	expect(textarea.value).toBe("/clear ");
	expect(onSend).not.toHaveBeenCalled();
});
