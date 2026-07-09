// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
	cleanup,
	fireEvent,
	render,
	waitFor,
	within,
} from "@testing-library/react";
import { act } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { BridgeTokenRow } from "@/utils/api-types";
import { LocalAgentSettingsDialog } from "./local-agent-settings-dialog";

/** Opens a base-ui `Select` and picks the option with the given accessible
 * name — plain `fireEvent.click` alone doesn't register the pick in jsdom, so
 * this mirrors the exact event sequence base-ui listens for (see
 * terminal-controls.test.tsx's identical helper). */
async function pickSelectOption(
	triggerLabel: string,
	optionName: string
): Promise<void> {
	const trigger = within(document.body).getByRole("combobox", {
		name: triggerLabel,
	});
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

vi.mock("sonner", () => ({
	toast: { error: vi.fn(), success: vi.fn() },
}));

const store = vi.hoisted(() => ({
	saveArgs: [] as Record<string, unknown>[],
}));

vi.mock("@/utils/orpc", () => ({
	orpc: {
		bridge: {
			listTokens: { key: () => ["bridge", "listTokens"] },
			restartSession: { call: vi.fn().mockResolvedValue({ ok: true }) },
			updateTokenConfig: {
				mutationOptions: (opts: Record<string, unknown>) => ({
					mutationFn: (args: Record<string, unknown>) => {
						store.saveArgs.push(args);
						return Promise.resolve({ ok: true });
					},
					...opts,
				}),
			},
		},
	},
}));

afterEach(cleanup);
beforeEach(() => {
	store.saveArgs.length = 0;
});

const NOT_CONFIGURABLE_RE = /no page-configurable startup settings yet/i;

function makeToken(overrides: Partial<BridgeTokenRow> = {}): BridgeTokenRow {
	return {
		id: "token-1",
		userId: "user-1",
		name: "alpha",
		agentKind: "claude-code",
		token: "bt_alpha",
		last4: "1234",
		config: null,
		createdAt: new Date("2026-07-04T12:00:00Z"),
		revokedAt: null,
		...overrides,
	};
}

function renderDialog(token: BridgeTokenRow, sessionId?: string) {
	const queryClient = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	const { baseElement } = render(
		<QueryClientProvider client={queryClient}>
			<LocalAgentSettingsDialog
				onOpenChange={() => undefined}
				open
				sessionId={sessionId}
				token={token}
			/>
		</QueryClientProvider>
	);
	// The dialog renders in a portal, so query from the document body.
	return within(baseElement);
}

it("shows the startup-config fields for claude-code (its adapter applies them)", () => {
	const view = renderDialog(makeToken());
	fireEvent.click(view.getByRole("tab", { name: "Config" }));
	expect(view.getByLabelText("Append system prompt")).toBeDefined();
	expect(view.getByLabelText("Max turns")).toBeDefined();
});

it("shows a 'not configurable yet' note for an agent whose adapter ignores config and has no model/permission capabilities", () => {
	// codex: agentAppliesConfig=false, modelSwitch=false, permissionModes=[] —
	// the only kind with zero fields to show.
	const view = renderDialog(makeToken({ agentKind: "codex" }));
	fireEvent.click(view.getByRole("tab", { name: "Config" }));
	// No fields that would persist but never apply…
	expect(view.queryByLabelText("Append system prompt")).toBeNull();
	expect(view.queryByLabelText("Model")).toBeNull();
	// …just an honest note.
	expect(view.getByText(NOT_CONFIGURABLE_RE)).toBeDefined();
});

it("shows the model field for a model-switch agent", () => {
	const view = renderDialog(makeToken());
	fireEvent.click(view.getByRole("tab", { name: "Config" }));
	expect(view.getByLabelText("Model")).toBeDefined();
});

it("shows the permission-mode select with the agent's capability options", async () => {
	// claude-code has permission modes — the select renders with its options.
	const view = renderDialog(makeToken());
	fireEvent.click(view.getByRole("tab", { name: "Config" }));
	expect(view.getByLabelText("Permission mode")).toBeDefined();
	await pickSelectOption("Permission mode", "plan");
});

it("hides the permission-mode select for pi (no permission modes), but still shows its model field", () => {
	// pi has no permission-mode concept at all — the select stays hidden, even
	// though pi's own model field still shows (modelSwitch is true for it).
	const view = renderDialog(makeToken({ agentKind: "pi" }));
	fireEvent.click(view.getByRole("tab", { name: "Config" }));
	expect(view.getByLabelText("Model")).toBeDefined();
	expect(view.queryByLabelText("Permission mode")).toBeNull();
});

it("flows model + permission-mode edits into the saved payload", async () => {
	const view = renderDialog(makeToken());
	fireEvent.click(view.getByRole("tab", { name: "Config" }));

	fireEvent.change(view.getByLabelText("Model"), {
		target: { value: "claude-opus-4" },
	});
	await pickSelectOption("Permission mode", "plan");

	fireEvent.click(view.getByRole("button", { name: "Save" }));

	await waitFor(() => {
		expect(store.saveArgs).toHaveLength(1);
	});
	expect(store.saveArgs[0]?.config).toMatchObject({
		model: "claude-opus-4",
		permissionMode: "plan",
	});
});

it("shows a plain 'Settings saved' toast when only LIVE fields (model/permission mode) changed", async () => {
	const { toast } = await import("sonner");
	const view = renderDialog(makeToken(), "session-1");
	fireEvent.click(view.getByRole("tab", { name: "Config" }));

	fireEvent.change(view.getByLabelText("Model"), {
		target: { value: "claude-opus-4" },
	});
	fireEvent.click(view.getByRole("button", { name: "Save" }));

	await waitFor(() => {
		expect(store.saveArgs).toHaveLength(1);
	});
	expect(toast.success).toHaveBeenCalledWith("Settings saved");
});

it("shows the restart hint with a 'Restart now' action when a non-LIVE field changes and a live sessionId is known", async () => {
	const { toast } = await import("sonner");
	const view = renderDialog(makeToken(), "session-1");
	fireEvent.click(view.getByRole("tab", { name: "Config" }));

	fireEvent.change(view.getByLabelText("Max turns"), {
		target: { value: "5" },
	});
	fireEvent.click(view.getByRole("button", { name: "Save" }));

	await waitFor(() => {
		expect(store.saveArgs).toHaveLength(1);
	});
	expect(toast.success).toHaveBeenCalledWith(
		"Saved — restart the agent to apply",
		expect.objectContaining({
			action: expect.objectContaining({ label: "Restart now" }),
		})
	);
});

it("shows only the informational restart note (no 'Restart now' action) when there's no live sessionId", async () => {
	const { toast } = await import("sonner");
	// No sessionId passed — mirrors this dialog opened from the connection
	// panel, before any session exists.
	const view = renderDialog(makeToken());
	fireEvent.click(view.getByRole("tab", { name: "Config" }));

	fireEvent.change(view.getByLabelText("Max turns"), {
		target: { value: "5" },
	});
	fireEvent.click(view.getByRole("button", { name: "Save" }));

	await waitFor(() => {
		expect(store.saveArgs).toHaveLength(1);
	});
	expect(toast.success).toHaveBeenCalledWith(
		"Saved — restart the agent to apply",
		expect.objectContaining({
			description: expect.stringContaining("Restart button"),
		})
	);
});
