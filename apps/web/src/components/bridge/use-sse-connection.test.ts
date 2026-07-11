// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
	degradeToPolling,
	makeConnectTransport,
	RECOVERY_INTERVAL_MS,
} from "./sse-connection-test-helpers";
import { type SseConnectionArgs, useSseConnection } from "./use-sse-connection";

// R0-T3: `useSseConnection` now owns its own recovery — while degraded to
// polling it retries its normal connect every 30s itself, and a successful
// retry keeps the SAME connection live rather than dispatching `open` and
// then reopening a second one right behind it (the bug this used to be
// exercised via `usePollFallback`'s now-deleted probe, see
// use-bridge-connection-effects.test.ts's history). Exercised at the effect
// level (rather than through the full `Terminal` component, as
// terminal.test.tsx does for the initial degrade) since the recovery timer is
// effect-owned state that a full render doesn't let a test control precisely
// with fake timers.

vi.mock("sonner", () => ({
	toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn() },
}));

function renderSseConnection(overrides: Partial<SseConnectionArgs> = {}) {
	const dispatchConn = vi.fn();
	const dispatchFeed = vi.fn();
	const maxSeenIdRef = { current: 5 };
	const fake = makeConnectTransport();
	const baseProps: SseConnectionArgs = {
		dispatchConn,
		dispatchFeed,
		enabled: true,
		maxSeenIdRef,
		sessionId: "session-1",
		transport: fake.transport,
		...overrides,
	};
	const view = renderHook(
		(props: SseConnectionArgs) => useSseConnection(props),
		{ initialProps: baseProps }
	);
	return { ...view, baseProps, dispatchConn, dispatchFeed, fake, maxSeenIdRef };
}

beforeEach(() => {
	vi.useFakeTimers();
});

afterEach(() => {
	vi.useRealTimers();
	vi.clearAllMocks();
});

it("reconnects immediately below MAX_SSE_FAILURES, then switches to a 30s recovery cadence once degraded", async () => {
	const { fake, maxSeenIdRef } = renderSseConnection();
	expect(fake.connectCalls.length).toBe(1);

	degradeToPolling(fake);
	// 3 immediate reconnects (initial + 2 retries) land exactly at the
	// degrade threshold — no 4th attempt fires until the recovery timer ticks.
	expect(fake.connectCalls.length).toBe(3);

	await act(async () => {
		await vi.advanceTimersByTimeAsync(RECOVERY_INTERVAL_MS - 1);
	});
	expect(fake.connectCalls.length).toBe(3);

	await act(async () => {
		await vi.advanceTimersByTimeAsync(1);
	});
	expect(fake.connectCalls.length).toBe(4);
	expect(fake.connectCalls[3].afterId).toBe(maxSeenIdRef.current);
});

it("shows the recovery toast only once actually degraded, never on the initial connect", async () => {
	const { dispatchConn, fake } = renderSseConnection();
	const { toast } = await import("sonner");

	act(() => {
		fake.current()?.onOpen();
	});
	expect(dispatchConn).toHaveBeenCalledWith({ type: "open" });
	expect(toast.success).not.toHaveBeenCalled();

	// Degrading again (3 more failures from live) reaches polling, then a
	// successful recovery retry is the only time the toast should fire.
	degradeToPolling(fake);
	await act(async () => {
		await vi.advanceTimersByTimeAsync(RECOVERY_INTERVAL_MS);
	});

	act(() => {
		fake.current()?.onOpen();
	});
	expect(toast.success).toHaveBeenCalledTimes(1);
	expect(toast.success).toHaveBeenCalledWith(
		"已恢复实时连接",
		expect.any(Object)
	);
});

it("a failed recovery attempt keeps retrying every 30s, without dispatching a failure", async () => {
	const { dispatchConn, fake } = renderSseConnection();
	degradeToPolling(fake);
	dispatchConn.mockClear();

	await act(async () => {
		await vi.advanceTimersByTimeAsync(RECOVERY_INTERVAL_MS);
	});
	expect(fake.connectCalls.length).toBe(4);

	act(() => {
		fake.current()?.onError();
	});
	expect(dispatchConn).not.toHaveBeenCalledWith({ type: "error" });

	await act(async () => {
		await vi.advanceTimersByTimeAsync(RECOVERY_INTERVAL_MS);
	});
	expect(fake.connectCalls.length).toBe(5);
});

it("resumes the recovered connection from the cursor advanced since degrading", async () => {
	const { fake, maxSeenIdRef } = renderSseConnection();
	degradeToPolling(fake);

	maxSeenIdRef.current = 42;
	await act(async () => {
		await vi.advanceTimersByTimeAsync(RECOVERY_INTERVAL_MS);
	});

	expect(fake.connectCalls.length).toBe(4);
	expect(fake.connectCalls[3].afterId).toBe(42);
});

it("never attempts to connect once disabled, e.g. an ended session", () => {
	const { fake } = renderSseConnection({ enabled: false });
	expect(fake.connectCalls.length).toBe(0);
});

it("tears down the in-flight connection and clears the recovery timer on unmount", async () => {
	const { fake, unmount } = renderSseConnection();
	degradeToPolling(fake);
	fake.connectCalls.length = 0;

	unmount();

	await act(async () => {
		await vi.advanceTimersByTimeAsync(RECOVERY_INTERVAL_MS * 2);
	});
	expect(fake.connectCalls.length).toBe(0);
});
