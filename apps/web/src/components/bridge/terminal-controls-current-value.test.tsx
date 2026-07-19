// @vitest-environment jsdom
import { render, waitFor, within } from "@testing-library/react";
import { act } from "react";
import { expect, it } from "vitest";
import { Terminal } from "./terminal";
import {
	makeControllableTransport,
	SESSION,
	sessionReadyRaw,
	waitForConnect,
} from "./terminal-test-helpers";

// The composer's model/permission menus must SHOW the session's current value
// as a human label while closed — not the raw wire value, not a blank trigger.
// On the task page the current value routinely isn't in the offered list (a
// startup config can set bypassPermissions; the init line reports a canonical
// model id while the switchable list holds aliases), and before this fix the
// closed trigger rendered the raw enum name or nothing at all.

/** Claude's full SDK PermissionMode enum (mirrors PERMISSION_MODES in
 * apps/bridge-cli/src/adapters/claude-code-startup-config.ts) mapped to the
 * label the closed trigger must show for each — 枚举全值对照. */
const CLAUDE_MODE_LABELS: Record<string, string> = {
	default: "Default",
	acceptEdits: "Accept edits",
	bypassPermissions: "Bypass permissions",
	plan: "Plan",
	dontAsk: "Don't ask",
	auto: "Auto",
};

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

function triggerText(container: HTMLElement, name: string): string {
	return within(container).getByRole("combobox", { name }).textContent ?? "";
}

it("shows the current permission mode's human label in the closed trigger", async () => {
	const { container } = await renderReady({ permissionMode: "acceptEdits" });

	expect(triggerText(container, "Permission mode")).toContain("Accept edits");
});

it("shows a labeled current mode even when it isn't among the offered modes", async () => {
	// A task session can START in bypassPermissions via its persisted startup
	// config; the menu deliberately doesn't OFFER that mode, but the composer
	// must still display it as the current value instead of a blank trigger.
	const { container } = await renderReady({
		permissionMode: "bypassPermissions",
	});

	expect(triggerText(container, "Permission mode")).toContain(
		"Bypass permissions"
	);
});

it("labels every claude permission mode value the SDK can report", async () => {
	for (const [mode, label] of Object.entries(CLAUDE_MODE_LABELS)) {
		const { container } = await renderReady({ permissionMode: mode });
		expect(triggerText(container, "Permission mode")).toContain(label);
	}
});

it("shows the current model in the menu even when it isn't in the reported list", async () => {
	const { container } = await renderReady({
		model: "claude-sonnet-4-5",
		models: ["sonnet", "opus"],
	});

	expect(triggerText(container, "Model")).toContain("claude-sonnet-4-5");
});

it("updates the displayed permission mode when a permission_mode_changed event arrives", async () => {
	const { container, fake } = await renderReady({ permissionMode: "default" });
	expect(triggerText(container, "Permission mode")).toContain("Default");

	await act(() => {
		fake.current()?.onEvent({
			id: 2,
			data: {
				kind: "status",
				status: "permission_mode_changed",
				detail: { permissionMode: "plan" },
			},
		});
	});

	await waitFor(() => {
		expect(triggerText(container, "Permission mode")).toContain("Plan");
	});
});

it("updates the displayed model when a model_changed event arrives", async () => {
	const { container, fake } = await renderReady({
		model: "sonnet",
		models: ["sonnet", "opus"],
	});
	expect(triggerText(container, "Model")).toContain("sonnet");

	await act(() => {
		fake.current()?.onEvent({
			id: 2,
			data: {
				kind: "status",
				status: "model_changed",
				detail: { model: "opus" },
			},
		});
	});

	await waitFor(() => {
		expect(triggerText(container, "Model")).toContain("opus");
	});
});
