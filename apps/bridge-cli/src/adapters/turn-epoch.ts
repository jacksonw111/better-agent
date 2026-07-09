// RC-T3 (docs/remote-control-redesign-plan.md, Pillar 3): the monotonic
// per-session turn counter every adapter tracks to fix the audited
// claude-code interrupt bug — `session.interrupt()` cancelled the SDK turn
// but never touched the pending-approval map, so a stale approval card
// survived into the NEXT turn and the user's late answer resolved a
// resolver whose context had already changed. `send()` and `interrupt()`
// both bump the epoch (see `bumpTurnEpoch`); `turnStampingQueue` embeds
// whichever epoch was current AT PUSH TIME onto every event, which is the
// only point that can distinguish a turn's own events from a straggler
// produced after the turn was superseded — see `forwardEvents` in
// relay-client.ts, the single place that then drops anything stale.

import type { AsyncQueue } from "./async-queue";

/** A mutable ref so `send`/`interrupt` (in the adapter) and the stamping
 * wrapper (wherever `events.push` is called) share the same live counter
 * without threading it through every call site. Starts at 0 — "no turn has
 * started yet"; `bumpTurnEpoch` is called once per `send()` (a new turn
 * begins) and once per `interrupt()`/`stop()` (the current turn, if any, is
 * superseded). */
export interface TurnEpochRef {
	current: number;
}

export function createTurnEpoch(): TurnEpochRef {
	return { current: 0 };
}

/** Advances the epoch and returns the new value. */
export function bumpTurnEpoch(epoch: TurnEpochRef): number {
	epoch.current += 1;
	return epoch.current;
}

/** Wraps an `AsyncQueue` so every pushed event is stamped with the epoch
 * that's current AT THE MOMENT `push` is called — not read lazily by a
 * downstream consumer, which would be too late to tell a straggler apart
 * from the next turn's own output (see the module doc above). `close` and
 * iteration pass straight through to `queue`, so this is a drop-in
 * replacement for the raw queue everywhere an adapter already holds one. */
export function turnStampingQueue<T extends { turnEpoch?: number }>(
	queue: AsyncQueue<T>,
	epoch: TurnEpochRef
): AsyncQueue<T> {
	return {
		push(event: T): void {
			queue.push({ ...event, turnEpoch: epoch.current });
		},
		close(): void {
			queue.close();
		},
		[Symbol.asyncIterator](): AsyncIterator<T> {
			return queue[Symbol.asyncIterator]();
		},
	};
}
