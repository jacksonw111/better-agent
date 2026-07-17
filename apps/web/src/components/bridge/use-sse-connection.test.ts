// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
	degradeToPolling,
	makeConnectTransport,
	RECOVERY_INTERVAL_MS,
} from "./sse-connection-test-helpers";
import {
	SSE_BACKOFF_BASE_MS,
	SSE_BACKOFF_MAX_MS,
	SSE_STABLE_RESET_MS,
	type SseConnectionArgs,
	useSseConnection,
} from "./use-sse-connection";

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

it("waits an exponential backoff before each reconnect below MAX_SSE_FAILURES", async () => {
	const { fake } = renderSseConnection();
	expect(fake.connectCalls.length).toBe(1);

	// First failure: no immediate reconnect — only after the base backoff.
	act(() => {
		fake.current()?.onError();
	});
	expect(fake.connectCalls.length).toBe(1);
	await act(async () => {
		await vi.advanceTimersByTimeAsync(SSE_BACKOFF_BASE_MS - 1);
	});
	expect(fake.connectCalls.length).toBe(1);
	await act(async () => {
		await vi.advanceTimersByTimeAsync(1);
	});
	expect(fake.connectCalls.length).toBe(2);

	// Second consecutive failure: the wait doubles.
	act(() => {
		fake.current()?.onError();
	});
	await act(async () => {
		await vi.advanceTimersByTimeAsync(SSE_BACKOFF_BASE_MS);
	});
	expect(fake.connectCalls.length).toBe(2);
	await act(async () => {
		await vi.advanceTimersByTimeAsync(SSE_BACKOFF_BASE_MS);
	});
	expect(fake.connectCalls.length).toBe(3);
});

it("switches from backoff reconnects to the 30s recovery cadence once degraded", async () => {
	const { fake, maxSeenIdRef } = renderSseConnection();
	await degradeToPolling(fake);
	// 3 attempts (initial + 2 backoff retries) land exactly at the degrade
	// threshold — no 4th attempt fires until the recovery timer ticks.
	expect(fake.connectCalls.length).toBe(3);

	await act(async () => {
		await vi.advanceTimersByTimeAsync(
			RECOVERY_INTERVAL_MS - SSE_BACKOFF_MAX_MS - 1
		);
	});
	expect(fake.connectCalls.length).toBe(3);

	await act(async () => {
		await vi.advanceTimersByTimeAsync(1);
	});
	expect(fake.connectCalls.length).toBe(4);
	expect(fake.connectCalls[3].afterId).toBe(maxSeenIdRef.current);
});

it("still degrades when every open dies within the stability window (open-then-close flapping)", async () => {
	const { fake } = renderSseConnection();
	for (let i = 0; i < 3; i++) {
		act(() => {
			fake.current()?.onOpen();
		});
		act(() => {
			fake.current()?.onError();
		});
		await act(async () => {
			await vi.advanceTimersByTimeAsync(SSE_BACKOFF_MAX_MS);
		});
	}
	// The flapping opens never reset the failure streak, so the third quick
	// drop degrades: no backoff reconnect, only the 30s recovery cadence.
	expect(fake.connectCalls.length).toBe(3);
	await act(async () => {
		await vi.advanceTimersByTimeAsync(RECOVERY_INTERVAL_MS);
	});
	expect(fake.connectCalls.length).toBe(4);
});

it("resets the failure streak only after a connection survives the stability window", async () => {
	const { dispatchConn, fake } = renderSseConnection();
	// Two quick failures put the streak one short of degrading.
	for (let i = 0; i < 2; i++) {
		act(() => {
			fake.current()?.onError();
		});
		await act(async () => {
			await vi.advanceTimersByTimeAsync(SSE_BACKOFF_MAX_MS);
		});
	}
	expect(fake.connectCalls.length).toBe(3);

	// This attempt opens and stays alive past the stability window, THEN drops.
	act(() => {
		fake.current()?.onOpen();
	});
	await act(async () => {
		await vi.advanceTimersByTimeAsync(SSE_STABLE_RESET_MS);
	});
	act(() => {
		fake.current()?.onError();
	});
	expect(dispatchConn).toHaveBeenCalledWith({ type: "error", wasStable: true });

	// A degraded loop would sit silent until the 30s recovery tick; the reset
	// streak reconnects on the base backoff instead.
	expect(fake.connectCalls.length).toBe(3);
	await act(async () => {
		await vi.advanceTimersByTimeAsync(SSE_BACKOFF_BASE_MS);
	});
	expect(fake.connectCalls.length).toBe(4);
});

it("clears a pending backoff reconnect on unmount", async () => {
	const { fake, unmount } = renderSseConnection();
	act(() => {
		fake.current()?.onError();
	});
	unmount();
	await act(async () => {
		await vi.advanceTimersByTimeAsync(SSE_BACKOFF_MAX_MS);
	});
	expect(fake.connectCalls.length).toBe(1);
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
	await degradeToPolling(fake);
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
	await degradeToPolling(fake);
	dispatchConn.mockClear();

	await act(async () => {
		await vi.advanceTimersByTimeAsync(RECOVERY_INTERVAL_MS);
	});
	expect(fake.connectCalls.length).toBe(4);

	act(() => {
		fake.current()?.onError();
	});
	expect(dispatchConn).not.toHaveBeenCalled();

	await act(async () => {
		await vi.advanceTimersByTimeAsync(RECOVERY_INTERVAL_MS);
	});
	expect(fake.connectCalls.length).toBe(5);
});

it("resumes the recovered connection from the cursor advanced since degrading", async () => {
	const { fake, maxSeenIdRef } = renderSseConnection();
	await degradeToPolling(fake);

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
	await degradeToPolling(fake);
	fake.connectCalls.length = 0;

	unmount();

	await act(async () => {
		await vi.advanceTimersByTimeAsync(RECOVERY_INTERVAL_MS * 2);
	});
	expect(fake.connectCalls.length).toBe(0);
});
