// @vitest-environment jsdom
import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { act } from "react";
import { afterEach, expect, it } from "vitest";
import { Terminal } from "./terminal";
import {
	makeControllableTransport,
	SESSION,
	waitForConnect,
} from "./terminal-test-helpers";

// R1-c: the "Status" button asks the CLI adapter for its current on-demand
// status (`{ control: getStatus }`) and renders whatever `status_snapshot`
// status event comes back — see use-bridge-terminal.ts and
// status-snapshot-panel.tsx. Popover content renders through a portal onto
// `document.body`, outside the `render()` container, so these assertions
// query via `screen` (the whole document) — each render must be torn down
// afterward or the next test's `screen` query sees both.

afterEach(() => {
	cleanup();
});

it("sends a getStatus control command via sendInput when the button is opened", async () => {
	const fake = makeControllableTransport();
	render(<Terminal session={SESSION} transport={fake.transport} />);
	await waitForConnect(fake);
	await act(() => {
		fake.current()?.onOpen();
	});

	await act(() => {
		fireEvent.click(screen.getByRole("button", { name: "Status" }));
	});

	await waitFor(() => {
		expect(fake.sendInput).toHaveBeenCalledWith({
			sessionId: SESSION.id,
			data: { type: "control", action: "getStatus" },
		});
	});
});

it("renders the status_snapshot detail's model, context usage, cost, tokens, running and mcp servers", async () => {
	const fake = makeControllableTransport();
	fake.history.mockResolvedValue([
		{
			seq: 1,
			event: {
				kind: "status",
				status: "status_snapshot",
				detail: {
					model: "claude-opus-4",
					permissionMode: "default",
					running: true,
					contextUsage: { used: 48_213, size: 200_000, pct: 24 },
					costUsd: 0.0456,
					tokens: { input: 1000, output: 500, cacheRead: 200, cacheWrite: 50 },
					mcpServers: [{ name: "playwright", status: "connected" }],
				},
			},
		},
	]);
	render(<Terminal session={SESSION} transport={fake.transport} />);
	await act(() => {
		fireEvent.click(screen.getByRole("button", { name: "Status" }));
	});

	await waitFor(() => {
		expect(screen.getByText("claude-opus-4")).toBeDefined();
	});
	expect(screen.getByText("default")).toBeDefined();
	expect(screen.getByText("Running")).toBeDefined();
	expect(screen.getByText("48k/200k tok · 24%")).toBeDefined();
	expect(screen.getByText("$0.0456")).toBeDefined();
	expect(screen.getByText("playwright")).toBeDefined();
});

it("shows an empty state when no status_snapshot has arrived yet", async () => {
	const fake = makeControllableTransport();
	render(<Terminal session={SESSION} transport={fake.transport} />);
	await act(() => {
		fireEvent.click(screen.getByRole("button", { name: "Status" }));
	});

	await waitFor(() => {
		expect(
			screen.getByText("No status yet — refresh to ask the agent.")
		).toBeDefined();
	});
});
