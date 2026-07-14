// @vitest-environment jsdom
import { cleanup, fireEvent, render, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import {
	TerminalComposer,
	type TerminalComposerProps,
} from "./terminal-composer";

// P2-T5: Tab / Shift+Tab cycle the permission mode from the composer
// textarea (see permission-mode-cycle.ts). preventDefault fires ONLY when a
// cycle actually happens — asserted via fireEvent's return value (false ⇔
// defaultPrevented), so native Tab focus movement survives every no-op case.

const MODES = ["default", "acceptEdits", "plan"];

afterEach(cleanup);

function renderComposer(overrides: Partial<TerminalComposerProps> = {}) {
	const onSetPermissionMode = vi.fn();
	const { container } = render(
		<TerminalComposer
			disabled={false}
			onSend={vi.fn()}
			onSetPermissionMode={onSetPermissionMode}
			permissionMode="default"
			permissionModes={MODES}
			sending={false}
			{...overrides}
		/>
	);
	const textarea = within(container).getByLabelText(
		"Message"
	) as HTMLTextAreaElement;
	return { container, onSetPermissionMode, textarea };
}

it("Tab cycles to the next permission mode, wrapping past the end", () => {
	const { onSetPermissionMode, textarea } = renderComposer();

	expect(fireEvent.keyDown(textarea, { key: "Tab" })).toBe(false);
	expect(fireEvent.keyDown(textarea, { key: "Tab" })).toBe(false);
	expect(fireEvent.keyDown(textarea, { key: "Tab" })).toBe(false);

	// Each press advances from the OPTIMISTIC mode (the agent hasn't confirmed
	// yet), so three presses walk the whole list and wrap back around.
	expect(onSetPermissionMode.mock.calls).toEqual([
		["acceptEdits"],
		["plan"],
		["default"],
	]);
});

it("Shift+Tab cycles backwards, wrapping past the start", () => {
	const { onSetPermissionMode, textarea } = renderComposer();

	expect(fireEvent.keyDown(textarea, { key: "Tab", shiftKey: true })).toBe(
		false
	);

	expect(onSetPermissionMode).toHaveBeenCalledWith("plan");
});

it("keeps native Tab while the slash picker is open", () => {
	const { onSetPermissionMode, textarea } = renderComposer({
		slashCommands: ["compact", "clear"],
	});
	fireEvent.change(textarea, { target: { value: "/" } });

	expect(fireEvent.keyDown(textarea, { key: "Tab" })).toBe(true);
	expect(onSetPermissionMode).not.toHaveBeenCalled();
});

it("keeps native Tab when the session offers fewer than two modes", () => {
	const single = renderComposer({ permissionModes: ["default"] });
	expect(fireEvent.keyDown(single.textarea, { key: "Tab" })).toBe(true);
	expect(single.onSetPermissionMode).not.toHaveBeenCalled();
	cleanup();

	const none = renderComposer({ permissionModes: undefined });
	expect(fireEvent.keyDown(none.textarea, { key: "Tab" })).toBe(true);
	expect(none.onSetPermissionMode).not.toHaveBeenCalled();
});

it("keeps native behavior for Ctrl/Meta/Alt-modified Tab", () => {
	const { onSetPermissionMode, textarea } = renderComposer();

	expect(fireEvent.keyDown(textarea, { key: "Tab", ctrlKey: true })).toBe(true);
	expect(fireEvent.keyDown(textarea, { key: "Tab", metaKey: true })).toBe(true);
	expect(fireEvent.keyDown(textarea, { key: "Tab", altKey: true })).toBe(true);
	expect(onSetPermissionMode).not.toHaveBeenCalled();
});
