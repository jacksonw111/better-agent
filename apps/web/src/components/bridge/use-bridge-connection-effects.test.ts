// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { BridgeTransport, ConnectStreamArgs } from "./bridge-transport";
import {
	type PollFallbackArgs,
	usePollFallback,
} from "./use-bridge-connection-effects";

// R0-T3: the poll fallback's SSE-recovery timer. While degraded to polling it
// retries an SSE upgrade every 30s via the same `connectStream` path, forever
// — see terminal-connection.ts for why a recovery failure must never
// accumulate toward MAX_SSE_FAILURES. Exercised at the effect level (rather
// than through the full `Terminal` component, as terminal.test.tsx does for
// the initial degrade) since the recovery timer is effect-owned state that a
// full render doesn't let a test control precisely with fake timers.

vi.mock("sonner", () => ({
	toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn() },
}));

const RECOVERY_INTERVAL_MS = 30_000;

function makeConnectTransport() {
	const connectCalls: ConnectStreamArgs[] = [];
	let latest: ConnectStreamArgs | null = null;
	const observe = vi.fn().mockResolvedValue([]);
	const transport: BridgeTransport = {
		connectStream: (args) => {
			latest = args;
			connectCalls.push(args);
			return vi.fn();
		},
		history: vi.fn().mockResolvedValue([]),
		observe,
		sendInput: vi.fn().mockResolvedValue(undefined),
	};
	return { connectCalls, current: () => latest, observe, transport };
}

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
	return { ...view, baseProps, dispatchConn, dispatchFeed, fake, maxSeenIdRef };
}

beforeEach(() => {
	vi.useFakeTimers();
});

afterEach(() => {
	vi.useRealTimers();
	vi.clearAllMocks();
});

it("attempts an SSE upgrade only after 30s of polling, using the shared afterId cursor", async () => {
	const { fake } = renderPollFallback();

	await act(async () => {
		await vi.advanceTimersByTimeAsync(RECOVERY_INTERVAL_MS - 1);
	});
	expect(fake.connectCalls.length).toBe(0);

	await act(async () => {
		await vi.advanceTimersByTimeAsync(1);
	});
	expect(fake.connectCalls.length).toBe(1);
	expect(fake.connectCalls[0].afterId).toBe(5);
});

it("recovers to live on a successful upgrade: dispatches open and shows the recovery toast once", async () => {
	const { dispatchConn, fake } = renderPollFallback();
	await act(async () => {
		await vi.advanceTimersByTimeAsync(RECOVERY_INTERVAL_MS);
	});
	expect(fake.connectCalls.length).toBe(1);

	act(() => {
		fake.current()?.onOpen();
	});

	expect(dispatchConn).toHaveBeenCalledWith({ type: "open" });
	const { toast } = await import("sonner");
	expect(toast.success).toHaveBeenCalledTimes(1);
	expect(toast.success).toHaveBeenCalledWith(
		"已恢复实时连接",
		expect.any(Object)
	);
});

it("stops polling and retrying once the caller reflects the recovered live status", async () => {
	const { baseProps, fake, rerender } = renderPollFallback();
	await act(async () => {
		await vi.advanceTimersByTimeAsync(RECOVERY_INTERVAL_MS);
	});
	act(() => {
		fake.current()?.onOpen();
	});

	// Mirrors what the real connectionReducer does with the "open" action this
	// hook just dispatched — the caller (useBridgeTerminal) would re-render
	// usePollFallback with the new status, which must tear the effect down.
	rerender({ ...baseProps, status: "live" });
	fake.observe.mockClear();
	fake.connectCalls.length = 0;

	await act(async () => {
		await vi.advanceTimersByTimeAsync(RECOVERY_INTERVAL_MS * 2);
	});
	expect(fake.connectCalls.length).toBe(0);
	expect(fake.observe).not.toHaveBeenCalled();
});

it("a failed upgrade attempt leaves it polling, without accumulating a failure count, retried at the next tick", async () => {
	const { dispatchConn, fake } = renderPollFallback();
	await act(async () => {
		await vi.advanceTimersByTimeAsync(RECOVERY_INTERVAL_MS);
	});
	expect(fake.connectCalls.length).toBe(1);

	act(() => {
		fake.current()?.onError();
	});
	expect(dispatchConn).not.toHaveBeenCalledWith({ type: "error" });

	await act(async () => {
		await vi.advanceTimersByTimeAsync(RECOVERY_INTERVAL_MS);
	});
	expect(fake.connectCalls.length).toBe(2);
	expect(fake.connectCalls[1].afterId).toBe(5);
});

it("resumes the recovered SSE connection from the cursor polling has already advanced", async () => {
	const { fake, maxSeenIdRef } = renderPollFallback();
	await act(async () => {
		await vi.advanceTimersByTimeAsync(RECOVERY_INTERVAL_MS - 5000);
	});
	// Simulates a poll tick's dispatchFeed advancing the shared cursor.
	maxSeenIdRef.current = 42;
	await act(async () => {
		await vi.advanceTimersByTimeAsync(5000);
	});

	expect(fake.connectCalls.length).toBe(1);
	expect(fake.connectCalls[0].afterId).toBe(42);
});

it("never attempts a poll or an SSE upgrade once disabled, e.g. an ended session", async () => {
	const { fake } = renderPollFallback({ enabled: false });

	await act(async () => {
		await vi.advanceTimersByTimeAsync(RECOVERY_INTERVAL_MS * 3);
	});
	expect(fake.connectCalls.length).toBe(0);
	expect(fake.observe).not.toHaveBeenCalled();
});

it("clears both the poll and the recovery timers on unmount", async () => {
	const { fake, unmount } = renderPollFallback();
	await act(async () => {
		await vi.advanceTimersByTimeAsync(RECOVERY_INTERVAL_MS - 1000);
	});
	unmount();
	fake.observe.mockClear();
	fake.connectCalls.length = 0;

	await act(async () => {
		await vi.advanceTimersByTimeAsync(RECOVERY_INTERVAL_MS * 2);
	});
	expect(fake.connectCalls.length).toBe(0);
	expect(fake.observe).not.toHaveBeenCalled();
});

it("shows the degrade toast once on entering polling, without duplicating on an unrelated rerender", async () => {
	const { toast } = await import("sonner");
	const { baseProps, rerender } = renderPollFallback();

	expect(toast.warning).toHaveBeenCalledTimes(1);
	expect(toast.warning).toHaveBeenCalledWith(
		"实时连接中断，已切换为轮询",
		expect.any(Object)
	);

	// Same deps (status still "polling") — the effect must not rerun, so the
	// toast must not fire again.
	rerender({ ...baseProps });
	expect(toast.warning).toHaveBeenCalledTimes(1);
});
