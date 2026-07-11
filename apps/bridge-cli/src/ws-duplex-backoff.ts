// R0-T2 (local-agent transport refactor): the reconnect backoff schedule for
// the WS duplex channel's internal reconnect loop (see
// ws-duplex-reconnect.ts). Split into its own file purely so the schedule —
// and the "3 consecutive failures" cap the pinned design fixes — has a single
// obvious, independently-testable home.

/** 1s, 2s, 4s, 8s, 16s, 30s(cap) — indexed by (0-based) reconnect attempt
 * number, per R0-T2's pinned design ("backoff 1s,2s,4s…30s cap"). */
const RECONNECT_DELAYS_MS = [1000, 2000, 4000, 8000, 16_000, 30_000];

/** How many consecutive failed reconnect attempts the channel tolerates
 * before giving up and firing `onDown` — see ws-duplex-reconnect.ts. */
export const MAX_CONSECUTIVE_RECONNECT_FAILURES = 3;

/** The backoff delay (ms) to wait before the `attempt`-th (0-indexed)
 * reconnect attempt — doubles up to the schedule's cap, then holds there for
 * any further attempt index. */
export function reconnectDelayMs(attempt: number): number {
	const index = Math.min(attempt, RECONNECT_DELAYS_MS.length - 1);
	return RECONNECT_DELAYS_MS[index] ?? RECONNECT_DELAYS_MS.at(-1) ?? 30_000;
}
