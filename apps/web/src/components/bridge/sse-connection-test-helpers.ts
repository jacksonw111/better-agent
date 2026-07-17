import { act } from "@testing-library/react";
import { vi } from "vitest";
import type { BridgeTransport, ConnectStreamArgs } from "./bridge-transport";
import { SSE_BACKOFF_MAX_MS } from "./use-sse-connection";

/** Shared fixtures for use-sse-connection.test.ts and
 * use-bridge-connection-effects.test.ts — split out so neither trips the
 * repo's max-lines-per-file gate, but both drive the same fake `connectStream`
 * shape. Not itself a `*.test.*` file, so vitest's include glob skips it. */

export const RECOVERY_INTERVAL_MS = 30_000;
export const POLL_INTERVAL_MS = 2000;

export function makeConnectTransport() {
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

/** Degrades a fresh `useSseConnection` instance to polling by failing
 * MAX_SSE_FAILURES (3) connect attempts in a row — the same path a real
 * dropped connection takes. Each failure's exponential-backoff reconnect is
 * flushed by advancing fake timers past the backoff cap, so this leaves
 * exactly 3 connect calls behind (the initial one + 2 backoff reconnects).
 * Requires `vi.useFakeTimers()` to be active. */
export async function degradeToPolling(
	fake: ReturnType<typeof makeConnectTransport>
): Promise<void> {
	const failuresToDegrade = 3;
	for (let i = 0; i < failuresToDegrade; i++) {
		act(() => {
			fake.current()?.onError();
		});
		await act(async () => {
			await vi.advanceTimersByTimeAsync(SSE_BACKOFF_MAX_MS);
		});
	}
}
