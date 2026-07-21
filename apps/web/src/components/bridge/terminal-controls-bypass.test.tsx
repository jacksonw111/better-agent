// @vitest-environment jsdom
import { render, waitFor, within } from "@testing-library/react";
import { act } from "react";
import { expect, it } from "vitest";
import { Terminal } from "./terminal";
import {
	makeControllableTransport,
	pickSelectOption,
	SESSION,
	sessionReadyRaw,
	waitForConnect,
} from "./terminal-test-helpers";

// Full-auto bypassPermissions UI (owner request): split into its own file from
// terminal-controls.test.tsx to keep both under the repo's 300-line-per-file
// cap. Covers the menu offering the mode and the persistent warning badge a
// session in it wears.

/** Renders a live claude terminal and seeds a `session_ready` with `detail`,
 * so the composer's menus + header badge have data to render. */
async function renderReady(detail: Record<string, unknown>): Promise<{
	container: HTMLElement;
	fake: ReturnType<typeof makeControllableTransport>;
}> {
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
	return { container, fake };
}

it("offers the full-auto bypassPermissions mode and dispatches it on pick", async () => {
	// Full-auto "allow everything" is a one-click LIVE option for claude now
	// (its static matrix + the CLI handshake both list it).
	const { container, fake } = await renderReady({ permissionMode: "default" });

	await pickSelectOption(
		container,
		"Permission mode",
		"Bypass permissions（全自动 allow）"
	);

	await waitFor(() => {
		expect(fake.sendInput).toHaveBeenCalledWith({
			sessionId: SESSION.id,
			data: {
				type: "control",
				action: "setPermissionMode",
				mode: "bypassPermissions",
			},
			idempotencyKey: expect.any(String),
		});
	});
});

it("shows a persistent full-auto warning badge only while the session is in bypassPermissions", async () => {
	const { container, fake } = await renderReady({
		permissionMode: "bypassPermissions",
	});
	// In full-auto the destructive badge is the continuously-visible signal that
	// nothing here pauses for approval.
	expect(within(container).getByText("全自动 allow")).toBeTruthy();

	// A read-back switching OFF bypass removes it (the fold overlays the newer
	// permission_mode_changed value onto session_ready).
	await act(() => {
		fake.current()?.onEvent({
			id: 2,
			data: {
				kind: "status",
				status: "permission_mode_changed",
				detail: { permissionMode: "default" },
			},
		});
	});
	await waitFor(() => {
		expect(within(container).queryByText("全自动 allow")).toBeNull();
	});
});
