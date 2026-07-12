// @vitest-environment jsdom
import { render, waitFor, within } from "@testing-library/react";
import { act } from "react";
import { expect, it } from "vitest";
import { Terminal } from "./terminal";
import {
	EVENT_TEXT_PATTERN,
	makeControllableTransport,
	SESSION,
	statusRaw,
	waitForConnect,
} from "./terminal-test-helpers";

// Covers the Phase 0 "load persisted history on mount" behavior: on reload,
// `transport.history` seeds the feed BEFORE the live SSE/poll connection is
// allowed to open (see useHistorySeed's doc in
// use-bridge-connection-effects.ts), and once seeded, live events that
// overlap the seeded backlog dedupe by id through the same `mergeEvents`
// path a live replay would use.

it("seeds the feed from persisted history on mount, before any live event arrives", async () => {
	const fake = makeControllableTransport();
	fake.history.mockResolvedValue([
		{ seq: 1, event: { kind: "status", status: "restarting" } },
		{ seq: 2, event: { kind: "status", status: "restarted" } },
	]);
	const { container } = render(
		<Terminal session={SESSION} transport={fake.transport} />
	);

	const view = within(container);
	await waitFor(() => {
		expect(
			view.getAllByText(EVENT_TEXT_PATTERN).map((el) => el.textContent)
		).toEqual(["正在重启 agent…", "agent 已重启"]);
	});
	expect(fake.history).toHaveBeenCalledWith({ sessionId: SESSION.id });
});

it("opens the live connection only after history has been seeded", async () => {
	const fake = makeControllableTransport();
	let resolveHistory: (() => void) | undefined;
	fake.history.mockReturnValue(
		new Promise((resolve) => {
			resolveHistory = () => resolve([]);
		})
	);
	render(<Terminal session={SESSION} transport={fake.transport} />);

	// While the history fetch is still pending, the live connection must not
	// have opened yet — connectStream is gated on the seed settling.
	expect(fake.connectCalls.length).toBe(0);

	resolveHistory?.();
	await waitForConnect(fake);
	expect(fake.connectCalls.length).toBe(1);
});

it("doesn't duplicate a live event whose id was already delivered via history", async () => {
	const fake = makeControllableTransport();
	fake.history.mockResolvedValue([
		{ seq: 1, event: { kind: "status", status: "restarting" } },
		{ seq: 2, event: { kind: "status", status: "restarted" } },
	]);
	const { container } = render(
		<Terminal session={SESSION} transport={fake.transport} />
	);
	const view = within(container);
	await waitFor(() => {
		expect(view.getAllByText(EVENT_TEXT_PATTERN)).toHaveLength(2);
	});
	await waitForConnect(fake);

	// The live stream replays id 2 (already seeded from history) alongside a
	// genuinely new id 3 — only the new one should render.
	await act(() => {
		fake.current()?.onEvent(statusRaw(2, "restarted"));
		fake.current()?.onEvent(statusRaw(3, "stopped_by_server"));
	});

	await waitFor(() => {
		expect(
			view.getAllByText(EVENT_TEXT_PATTERN).map((el) => el.textContent)
		).toEqual(["正在重启 agent…", "agent 已重启", "会话已由服务端结束"]);
	});
});

it("keeps appending live events normally after the history seed", async () => {
	const fake = makeControllableTransport();
	fake.history.mockResolvedValue([
		{ seq: 1, event: { kind: "status", status: "restarting" } },
	]);
	const { container } = render(
		<Terminal session={SESSION} transport={fake.transport} />
	);
	const view = within(container);
	await waitFor(() => {
		expect(view.getAllByText(EVENT_TEXT_PATTERN)).toHaveLength(1);
	});
	await waitForConnect(fake);

	await act(() => {
		fake.current()?.onEvent(statusRaw(2, "restarted"));
	});
	await waitFor(() => {
		expect(
			view.getAllByText(EVENT_TEXT_PATTERN).map((el) => el.textContent)
		).toEqual(["正在重启 agent…", "agent 已重启"]);
	});

	await act(() => {
		fake.current()?.onEvent(statusRaw(3, "stopped_by_server"));
	});
	await waitFor(() => {
		expect(
			view.getAllByText(EVENT_TEXT_PATTERN).map((el) => el.textContent)
		).toEqual(["正在重启 agent…", "agent 已重启", "会话已由服务端结束"]);
	});
});
