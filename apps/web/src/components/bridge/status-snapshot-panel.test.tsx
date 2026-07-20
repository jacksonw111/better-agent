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

const REMAINING_62_PATTERN = /剩余 62%/;
const RESETS_2H_PATTERN = /2 ?小时后重置/;
const UPDATED_PATTERN = /更新于/;

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
			// fix-send-outbox: every send now carries the outbox's idempotency key.
			idempotencyKey: expect.any(String),
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

// R4-T2: the account-quota section (R4-T1's `quota` field) — remaining%
// inversion (the bar fills by `usedPercent`, but the text reads how much is
// LEFT, not how much is used), a relative reset time, and a tiny "Updated…"
// timestamp off `fetchedAt`.
it("renders quota windows with the remaining% inversion and a relative reset time", async () => {
	const fake = makeControllableTransport();
	const resetsAt = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
	const fetchedAt = new Date(Date.now() - 60 * 1000).toISOString();
	fake.history.mockResolvedValue([
		{
			seq: 1,
			event: {
				kind: "status",
				status: "status_snapshot",
				detail: {
					quota: {
						provider: "codex",
						fetchedAt,
						windows: [
							{ label: "5h window", usedPercent: 38, resetsAt },
							{ label: "Weekly", usedPercent: 90 },
						],
					},
				},
			},
		},
	]);
	render(<Terminal session={SESSION} transport={fake.transport} />);
	await act(() => {
		fireEvent.click(screen.getByRole("button", { name: "Status" }));
	});

	await waitFor(() => {
		expect(screen.getByText("账号配额")).toBeDefined();
	});
	expect(screen.getByText("5h window")).toBeDefined();
	expect(screen.getByText(REMAINING_62_PATTERN)).toBeDefined();
	expect(screen.getByText(RESETS_2H_PATTERN)).toBeDefined();
	expect(screen.getByText("Weekly")).toBeDefined();
	expect(screen.getByText("剩余 10%")).toBeDefined();
	expect(screen.getByText(UPDATED_PATTERN)).toBeDefined();
});

it("shows a muted unavailable line when the quota fetch failed", async () => {
	const fake = makeControllableTransport();
	fake.history.mockResolvedValue([
		{
			seq: 1,
			event: {
				kind: "status",
				status: "status_snapshot",
				detail: {
					quota: {
						provider: "codex",
						fetchedAt: new Date().toISOString(),
						unavailableReason: "codex credentials not found",
						windows: [],
					},
				},
			},
		},
	]);
	render(<Terminal session={SESSION} transport={fake.transport} />);
	await act(() => {
		fireEvent.click(screen.getByRole("button", { name: "Status" }));
	});

	await waitFor(() => {
		expect(
			screen.getByText("配额信息不可用（codex credentials not found）")
		).toBeDefined();
	});
});

it("renders a stats-only detail (pi's shape) gracefully — no quota, no context, no mcp", async () => {
	const fake = makeControllableTransport();
	fake.history.mockResolvedValue([
		{
			seq: 1,
			event: {
				kind: "status",
				status: "status_snapshot",
				detail: { costUsd: 0.02, tokens: { input: 500, output: 200 } },
			},
		},
	]);
	render(<Terminal session={SESSION} transport={fake.transport} />);
	await act(() => {
		fireEvent.click(screen.getByRole("button", { name: "Status" }));
	});

	await waitFor(() => {
		expect(screen.getByText("This session")).toBeDefined();
	});
	expect(screen.getByText("$0.0200")).toBeDefined();
	expect(screen.queryByText("账号配额")).toBeNull();
});

it("degrades to nothing but the empty state's absence when every status_snapshot field is empty", async () => {
	const fake = makeControllableTransport();
	fake.history.mockResolvedValue([
		{
			seq: 1,
			event: { kind: "status", status: "status_snapshot", detail: {} },
		},
	]);
	render(<Terminal session={SESSION} transport={fake.transport} />);
	await act(() => {
		fireEvent.click(screen.getByRole("button", { name: "Status" }));
	});

	await waitFor(() => {
		expect(
			screen.getByRole("button", { name: "Refresh status" })
		).toBeDefined();
	});
	expect(screen.queryByText("账号配额")).toBeNull();
	expect(screen.queryByText("This session")).toBeNull();
});
