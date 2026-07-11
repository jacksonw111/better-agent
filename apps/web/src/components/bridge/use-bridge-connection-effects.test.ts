// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { useReducer, useState } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { BridgeTransport } from "./bridge-transport";
import {
	degradeToPolling,
	makeConnectTransport,
	POLL_INTERVAL_MS,
	RECOVERY_INTERVAL_MS,
} from "./sse-connection-test-helpers";
import {
	connectionReducer,
	initialConnectionState,
} from "./terminal-connection";
import {
	type PollFallbackArgs,
	usePollFallback,
} from "./use-bridge-connection-effects";
import { useSseConnection } from "./use-sse-connection";

// R0-T3: `usePollFallback` went back to purely polling — the SSE-upgrade
// probe it used to own moved into `useSseConnection` itself (see
// use-sse-connection.ts / use-sse-connection.test.ts for that hook's own
// recovery coverage). What's left here is the poll loop, plus a
// composition-level regression test for the bug this file used to have: two
// SSE connections briefly alive per recovery.

vi.mock("sonner", () => ({
	toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn() },
}));

function renderPollFallback(overrides: Partial<PollFallbackArgs> = {}) {
	const dispatchConn = vi.fn();
	const dispatchFeed = vi.fn();
	const maxSeenIdRef = { current: 5 };
	const fake = makeConnectTransport();
	const baseProps: PollFallbackArgs = {
		dispatchConn,
		dispatchFeed,
		enabled: true,
		maxSeenIdRef,
		sessionId: "session-1",
		status: "polling",
		transport: fake.transport,
		...overrides,
	};
	const view = renderHook((props: PollFallbackArgs) => usePollFallback(props), {
		initialProps: baseProps,
	});
	return { ...view, baseProps, dispatchConn, fake };
}

beforeEach(() => {
	vi.useFakeTimers();
});

afterEach(() => {
	vi.useRealTimers();
	vi.clearAllMocks();
});

it("polls observe(afterId) on a fixed interval while degraded, showing the degrade toast once", async () => {
	const { toast } = await import("sonner");
	const { baseProps, fake, rerender } = renderPollFallback();

	expect(fake.observe).toHaveBeenCalledTimes(1);
	expect(toast.warning).toHaveBeenCalledTimes(1);
	expect(toast.warning).toHaveBeenCalledWith(
		"实时连接中断，已切换为轮询",
		expect.any(Object)
	);

	await act(async () => {
		await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
	});
	expect(fake.observe).toHaveBeenCalledTimes(2);

	// Same deps (status still "polling") — the effect must not rerun, so the
	// toast must not fire again.
	rerender({ ...baseProps });
	expect(toast.warning).toHaveBeenCalledTimes(1);
});

it("never polls once disabled, e.g. an ended session, and stops on unmount", async () => {
	const disabled = renderPollFallback({ enabled: false });
	await act(async () => {
		await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 3);
	});
	expect(disabled.fake.observe).not.toHaveBeenCalled();

	const live = renderPollFallback();
	live.unmount();
	live.fake.observe.mockClear();
	await act(async () => {
		await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 3);
	});
	expect(live.fake.observe).not.toHaveBeenCalled();
});

// Composition: the real wiring (see `useLiveConnection` in
// use-bridge-terminal.ts) runs `useSseConnection` and `usePollFallback` off
// the SAME `ConnectionState` reducer — this is the shape the R0-T3 bug
// actually broke, so it's the shape a regression has to be caught in.
function useComposedConnection(props: {
	enabled: boolean;
	maxSeenIdRef: { current: number };
	sessionId: string;
	transport: BridgeTransport;
}) {
	const [dispatchFeed] = useState(() => vi.fn());
	const [conn, dispatchConn] = useReducer(
		connectionReducer,
		initialConnectionState
	);
	useSseConnection({ ...props, dispatchConn, dispatchFeed });
	usePollFallback({
		...props,
		status: conn.status,
		dispatchConn,
		dispatchFeed,
	});
	return conn;
}

it("degrade -> 30s tick -> exactly one connect attempt on recovery success, live, poll stopped", async () => {
	const fake = makeConnectTransport();
	const maxSeenIdRef = { current: 0 };
	const { result } = renderHook(() =>
		useComposedConnection({
			enabled: true,
			maxSeenIdRef,
			sessionId: "session-1",
			transport: fake.transport,
		})
	);

	degradeToPolling(fake);
	expect(result.current.status).toBe("polling");

	fake.connectCalls.length = 0;
	fake.observe.mockClear();

	await act(async () => {
		await vi.advanceTimersByTimeAsync(RECOVERY_INTERVAL_MS);
	});
	expect(fake.connectCalls.length).toBe(1);

	act(() => {
		fake.current()?.onOpen();
	});
	expect(result.current.status).toBe("live");

	fake.connectCalls.length = 0;
	fake.observe.mockClear();
	await act(async () => {
		await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 2);
	});
	// The connection that just recovered is the one staying live — nothing
	// reopened it, and the poll loop that was covering for it has stopped.
	expect(fake.connectCalls.length).toBe(0);
	expect(fake.observe).not.toHaveBeenCalled();
});
