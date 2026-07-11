// @vitest-environment jsdom
import { fireEvent, render, waitFor, within } from "@testing-library/react";
import { act } from "react";
import { expect, it } from "vitest";
import type { BridgeSessionRow } from "@/utils/api-types";
import { Terminal } from "./terminal";
import {
	CODEX_SESSION,
	ENDED_SESSION,
	makeControllableTransport,
	PI_SESSION,
	SESSION,
	sessionReadyRaw,
	waitForConnect,
} from "./terminal-test-helpers";

// The session controls (model menu / permission-mode menu / Stop) now live in
// the composer's bottom bar rather than a hardcoded header strip — and the
// model menu lists exactly what the AGENT reports (session_ready.models), not a
// baked-in opus/sonnet/haiku list. These cover that relocation + agent-sourced
// model list, wired through the same `sendInput` control path as before.

/** Opens a base-ui `Select` and picks the option with the given accessible
 * name — plain `fireEvent.click` alone doesn't register the pick in jsdom, so
 * this mirrors the exact event sequence base-ui listens for. */
async function pickSelectOption(
	container: HTMLElement,
	triggerLabel: string,
	optionName: string
): Promise<void> {
	const view = within(container);
	const trigger = view.getByRole("combobox", { name: triggerLabel });
	await act(() => {
		fireEvent.pointerDown(trigger, { button: 0, pointerId: 1 });
		fireEvent.click(trigger);
	});
	const option = await waitFor(() =>
		within(document.body).getByRole("option", { name: optionName })
	);
	await act(() => {
		fireEvent.pointerDown(option, { button: 0, pointerId: 1 });
		fireEvent.pointerUp(option, { button: 0, pointerId: 1 });
		fireEvent.click(option);
	});
}

/** Renders a live terminal (claude by default; pass `session` for another
 * agent kind) and seeds a `session_ready` with the given detail, so the
 * composer's agent-sourced menus have data to render. */
async function renderReady(
	detail: Record<string, unknown>,
	session: BridgeSessionRow = SESSION
): Promise<{
	container: HTMLElement;
	fake: ReturnType<typeof makeControllableTransport>;
}> {
	const fake = makeControllableTransport();
	const { container } = render(
		<Terminal session={session} transport={fake.transport} />
	);
	await waitForConnect(fake);
	await act(() => {
		fake.current()?.onOpen();
	});
	await act(() => {
		fake.current()?.onEvent(sessionReadyRaw(1, detail));
	});
	return { container, fake };
}

it("renders the model menu from the agent's reported models and dispatches setModel on pick", async () => {
	const { container, fake } = await renderReady({
		model: "opus",
		models: ["opus", "sonnet"],
	});

	// The menu lists exactly the reported ids — no hardcoded haiku, etc.
	await pickSelectOption(container, "Model", "sonnet");

	await waitFor(() => {
		expect(fake.sendInput).toHaveBeenCalledWith({
			sessionId: SESSION.id,
			data: { type: "control", action: "setModel", model: "sonnet" },
		});
	});
});

it("shows the current model as a disabled affordance when the agent reports no list", async () => {
	const { container } = await renderReady({ model: "opus" });

	// The model control is ALWAYS present (never fully hidden); with only a
	// current model and no switchable list it's a read-only label showing it.
	const trigger = within(container).getByRole("combobox", {
		name: "Model",
	}) as HTMLButtonElement;
	expect(trigger.disabled).toBe(true);
	expect(trigger.textContent).toContain("opus");
});

it("always shows a disabled Model affordance even when the agent reports nothing", async () => {
	const { container } = await renderReady({});

	const trigger = within(container).getByRole("combobox", {
		name: "Model",
	}) as HTMLButtonElement;
	expect(trigger.disabled).toBe(true);
});

it("dispatches a setPermissionMode control command when a mode is picked", async () => {
	const { container, fake } = await renderReady({ permissionMode: "default" });

	await pickSelectOption(container, "Permission mode", "Plan");

	await waitFor(() => {
		expect(fake.sendInput).toHaveBeenCalledWith({
			sessionId: SESSION.id,
			data: { type: "control", action: "setPermissionMode", mode: "plan" },
		});
	});
});

it("swaps Send for a Stop button while a turn is in flight and dispatches interrupt", async () => {
	const fake = makeControllableTransport();
	const { container } = render(
		<Terminal session={SESSION} transport={fake.transport} />
	);
	await waitForConnect(fake);
	await act(() => {
		fake.current()?.onOpen();
	});

	const view = within(container);
	const textarea = view.getByLabelText("Message") as HTMLTextAreaElement;
	fireEvent.change(textarea, { target: { value: "do it" } });
	await act(() => {
		fireEvent.click(view.getByRole("button", { name: "Send" }));
	});

	// The optimistic user echo puts the turn in flight → Send becomes Stop.
	const stop = await waitFor(() => view.getByRole("button", { name: "Stop" }));
	await act(() => {
		fireEvent.click(stop);
	});

	await waitFor(() => {
		expect(fake.sendInput).toHaveBeenCalledWith({
			sessionId: SESSION.id,
			data: { type: "control", action: "interrupt" },
		});
	});
});

it("no longer renders the model menu or an Interrupt button in the header", async () => {
	const { container } = await renderReady({
		model: "opus",
		models: ["opus", "sonnet"],
	});
	const view = within(container);

	// No standalone Interrupt control anywhere (it's now the in-flight Stop).
	expect(view.queryByRole("button", { name: "Interrupt" })).toBeNull();
	// The one model menu that exists lives in the composer, not the header.
	expect(view.getAllByRole("combobox", { name: "Model" })).toHaveLength(1);
});

it("disables the composer control menus for an already-ended session", () => {
	const fake = makeControllableTransport();
	const { container } = render(
		<Terminal session={ENDED_SESSION} transport={fake.transport} />
	);

	// The permission-mode menu renders for claude regardless of session_ready
	// (its options come from the capability matrix), so it's the one to check.
	expect(
		(
			within(container).getByRole("combobox", {
				name: "Permission mode",
			}) as HTMLButtonElement
		).disabled
	).toBe(true);
});

// R2-T4: the Thinking picker (pi's `set_thinking_level`, R2-T3 item 2) is
// driven entirely by the LIVE `session_ready.capabilities.thinkingLevels`
// handshake (see agent-capabilities.ts's `resolveCapabilities`) — the static
// matrix always reports an empty list, so these tests seed it on the
// `session_ready` event rather than relying on `agentKind` alone. The handshake
// must be a COMPLETE `SessionCapabilities` object (mirroring the `HANDSHAKE`
// fixture in agent-capabilities.test.ts) — `resolveCapabilities` overrides
// every one of its overlapping fields wholesale once a handshake is present,
// so a partial one would leave `permissionModes` etc. undefined and crash the
// composer's other menus.
const PI_HANDSHAKE_CAPABILITIES = {
	approval: "none",
	busyModes: ["queue"],
	mcp: "none",
	modelSwitch: true,
	permissionModes: [],
	quota: false,
	sessionOps: [],
	skills: true,
	slashCommands: true,
	thinkingLevels: ["low", "high"],
	usage: "poll",
};

it("renders the Thinking menu from the live handshake's thinkingLevels and dispatches setThinking on pick", async () => {
	const { container, fake } = await renderReady(
		{ capabilities: PI_HANDSHAKE_CAPABILITIES },
		PI_SESSION
	);

	await pickSelectOption(container, "Thinking", "High");

	await waitFor(() => {
		expect(fake.sendInput).toHaveBeenCalledWith({
			sessionId: PI_SESSION.id,
			data: { type: "control", action: "setThinking", level: "high" },
		});
	});
});

it("hides the Thinking menu for a claude session (no thinkingLevels reported)", async () => {
	const { container } = await renderReady({ model: "opus" });

	expect(
		within(container).queryByRole("combobox", { name: "Thinking" })
	).toBeNull();
});

it("hides the Thinking menu when the live handshake reports an empty thinkingLevels list", async () => {
	const { container } = await renderReady(
		{ capabilities: { ...PI_HANDSHAKE_CAPABILITIES, thinkingLevels: [] } },
		PI_SESSION
	);

	expect(
		within(container).queryByRole("combobox", { name: "Thinking" })
	).toBeNull();
});

it("shows a next-turn-effect tooltip on the model and permission menus for a codex session", async () => {
	const { container } = await renderReady(
		{ model: "gpt-5", models: ["gpt-5", "gpt-5-mini"] },
		CODEX_SESSION
	);
	const view = within(container);

	const model = view.getByRole("combobox", { name: "Model" });
	const permission = view.getByRole("combobox", { name: "Permission mode" });

	expect(model.getAttribute("title")).toBe("下一回合生效");
	expect(permission.getAttribute("title")).toBe("下一回合生效");
});

it("does not show the next-turn-effect tooltip for a claude session", async () => {
	const { container } = await renderReady({
		model: "opus",
		models: ["opus", "sonnet"],
	});
	const view = within(container);

	const model = view.getByRole("combobox", { name: "Model" });
	const permission = view.getByRole("combobox", { name: "Permission mode" });

	expect(model.getAttribute("title")).toBeNull();
	expect(permission.getAttribute("title")).toBeNull();
});
