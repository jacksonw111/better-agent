// @vitest-environment jsdom
import {
	cleanup,
	render,
	screen,
	waitFor,
	within,
} from "@testing-library/react";
import { act } from "react";
import { afterEach, expect, it } from "vitest";
import { Terminal } from "./terminal";
import {
	CODEX_SESSION,
	makeControllableTransport,
	PI_SESSION,
	SESSION,
	turnUsageRaw,
	waitForConnect,
} from "./terminal-test-helpers";

// Phase 0.5: the detail page gates every optional surface on the session's
// agentKind-derived capability matrix (see agent-capabilities.ts) instead of
// always assuming claude. `terminal.test.tsx`/`terminal-controls.test.tsx`
// already cover claude's full surface; this file covers pi (a reduced
// surface) and codex (session-list still off, model/permission live as of
// R2-T2) not regressing back to "show everything".

const COST_TEXT_PATTERN = /\$0\.05/;

afterEach(() => {
	cleanup();
});

it("hides Past conversations for a pi session (no session-list capability)", async () => {
	const fake = makeControllableTransport();
	const { container } = render(
		<Terminal session={PI_SESSION} transport={fake.transport} />
	);
	await waitForConnect(fake);
	await act(() => {
		fake.current()?.onOpen();
	});

	expect(
		within(container).queryByRole("button", { name: "Past conversations" })
	).toBeNull();
});

it("shows a disabled Model affordance for a pi session that reports no models", async () => {
	// pi's wired RPC surface doesn't expose a model list, but the model control
	// is ALWAYS present — here as a disabled affordance rather than a dropdown.
	const fake = makeControllableTransport();
	const { container } = render(
		<Terminal session={PI_SESSION} transport={fake.transport} />
	);
	await waitForConnect(fake);
	await act(() => {
		fake.current()?.onOpen();
	});

	const trigger = within(container).getByRole("combobox", {
		name: "Model",
	}) as HTMLButtonElement;
	expect(trigger.disabled).toBe(true);
});

it("hides the permission-mode menu for a pi session (pi has no approval concept — §2)", async () => {
	const fake = makeControllableTransport();
	const { container } = render(
		<Terminal session={PI_SESSION} transport={fake.transport} />
	);
	await waitForConnect(fake);
	await act(() => {
		fake.current()?.onOpen();
	});

	// pi explicitly has NO permission/approval flow — the menu must not render.
	expect(
		within(container).queryByRole("combobox", { name: "Permission mode" })
	).toBeNull();
});

it("skips the turn-usage chip for a pi session (usageMode is poll, not stream)", async () => {
	const fake = makeControllableTransport();
	render(<Terminal session={PI_SESSION} transport={fake.transport} />);
	await waitForConnect(fake);
	await act(() => {
		fake.current()?.onOpen();
	});
	await act(() => {
		fake.current()?.onEvent(turnUsageRaw(1, { costUsd: 0.05, numTurns: 1 }));
	});

	expect(screen.queryByText(COST_TEXT_PATTERN)).toBeNull();
});

it("keeps the claude session's turn-usage chip rendering (usageMode is stream)", async () => {
	const fake = makeControllableTransport();
	render(<Terminal session={SESSION} transport={fake.transport} />);
	await waitForConnect(fake);
	await act(() => {
		fake.current()?.onOpen();
	});
	await act(() => {
		fake.current()?.onEvent(turnUsageRaw(1, { costUsd: 0.05, numTurns: 1 }));
	});

	await waitFor(() => {
		expect(screen.getByText(COST_TEXT_PATTERN)).toBeDefined();
	});
});

// The Task Conversation page reuses this same Terminal but declutters the
// header: Past conversations (the run sidebar covers history there) and the
// Status popover are prop-gated OFF. /local never sets these props, so the
// claude coverage above (and terminal-header.test.tsx's Status assertions)
// pins the default-on behavior.
it("hides Past conversations when hidePastConversations is set, even for a claude session", async () => {
	const fake = makeControllableTransport();
	const { container } = render(
		<Terminal
			hidePastConversations
			session={SESSION}
			transport={fake.transport}
		/>
	);
	await waitForConnect(fake);
	await act(() => {
		fake.current()?.onOpen();
	});

	expect(
		within(container).queryByRole("button", { name: "Past conversations" })
	).toBeNull();
});

it("hides the Status button when hideStatusButton is set, even for a claude session", async () => {
	const fake = makeControllableTransport();
	const { container } = render(
		<Terminal hideStatusButton session={SESSION} transport={fake.transport} />
	);
	await waitForConnect(fake);
	await act(() => {
		fake.current()?.onOpen();
	});

	expect(
		within(container).queryByRole("button", { name: "Status" })
	).toBeNull();
});

it("hides Past conversations but shows the permission-mode dropdown (R2-T2) and keeps a disabled Model affordance for a codex session with no live session_ready", async () => {
	const fake = makeControllableTransport();
	const { container } = render(
		<Terminal session={CODEX_SESSION} transport={fake.transport} />
	);
	await waitForConnect(fake);
	await act(() => {
		fake.current()?.onOpen();
	});

	const view = within(container);
	expect(view.queryByRole("button", { name: "Past conversations" })).toBeNull();
	// R2-T2: codex's static matrix now reports real permissionModes
	// (untrusted/on-request/never) — the menu renders even before any
	// session_ready handshake arrives.
	expect(
		view.queryByRole("combobox", { name: "Permission mode" })
	).not.toBeNull();
	// The model control is always present — disabled here since no
	// session_ready has reported a switchable `models` list in this test.
	const model = view.getByRole("combobox", {
		name: "Model",
	}) as HTMLButtonElement;
	expect(model.disabled).toBe(true);
	// No standalone Interrupt control anymore — Stop only appears in-flight.
	expect(view.queryByRole("button", { name: "Interrupt" })).toBeNull();
});
