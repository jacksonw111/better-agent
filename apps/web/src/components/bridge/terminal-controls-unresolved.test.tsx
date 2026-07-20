// @vitest-environment jsdom
import { render, within } from "@testing-library/react";
import { act } from "react";
import { expect, it } from "vitest";
import { Terminal } from "./terminal";
import {
	makeControllableTransport,
	SESSION,
	sessionReadyRaw,
	waitForConnect,
} from "./terminal-test-helpers";

// No agent SDK exposes a READ for the live model / permission mode, so a
// resumed session (whose init line waits for a user turn that never comes) has
// no current value to show. The CLI now omits those fields instead of guessing
// a default — these pin what the composer renders in that gap. Split out of
// terminal-controls.test.tsx purely for the max-lines-per-file gate.

/** Renders a live claude terminal and seeds a `session_ready` with the given
 * detail — the composer's menus read their values off it. */
async function renderReady(detail: Record<string, unknown>) {
	const fake = makeControllableTransport();
	const { container } = render(
		<Terminal session={SESSION} transport={fake.transport} />
	);
	await waitForConnect(fake);
	await act(() => {
		fake.current()?.onOpen();
	});
	await act(() => {
		fake.current()?.onEvent(sessionReadyRaw(1, detail));
	});
	return { container };
}

it("marks a control whose current value the agent hasn't reported as 未确定", async () => {
	// A resumed session: the SDK can't be asked what model/mode it's on, and
	// the CLI now omits both rather than guessing. The menus still work — they
	// just have nothing selected — so they must say so instead of rendering a
	// bare label that reads as a chosen value.
	const { container } = await renderReady({ models: ["opus", "sonnet"] });
	const view = within(container);

	const model = view.getByRole("combobox", { name: "Model" });
	const permission = view.getByRole("combobox", { name: "Permission mode" });

	expect(model.textContent).toContain("未确定");
	expect(permission.textContent).toContain("未确定");
	expect(model.getAttribute("title")).toBe("发送首条消息后同步当前值");
});
