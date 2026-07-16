import type { RunEvent } from "@better-agent/agent/session/events";

// Decouples turn execution from the SSE response: a detached pump consumes the
// runtime's events into this channel, and the response merely OBSERVES it. If
// the client disconnects, the observer dies but the pump (kept alive via
// waitUntil) runs the turn to completion — parts keep persisting and finalize
// still runs. Only the cancel endpoint (Stop) aborts a turn early.
export interface TurnChannel {
	close(): void;
	observe(): AsyncGenerator<RunEvent, void>;
	push(event: RunEvent): void;
}

export function createTurnChannel(): TurnChannel {
	const buffer: RunEvent[] = [];
	let closed = false;
	// Multiple concurrent observers (the original SSE response AND any client
	// that reconnected via the observe endpoint) each keep their own cursor and
	// their own wake callback, so a reconnect never starves the original.
	const waiters = new Set<() => void>();
	const notify = () => {
		for (const resume of waiters) {
			resume();
		}
		waiters.clear();
	};
	return {
		push(event) {
			if (!closed) {
				buffer.push(event);
				notify();
			}
		},
		close() {
			closed = true;
			notify();
		},
		async *observe() {
			// Replay from the start so a late/reconnecting observer reconstructs
			// the whole turn (message-start + every delta so far), then tails live.
			let index = 0;
			while (true) {
				const next = buffer[index];
				if (next !== undefined) {
					index++;
					yield next;
					continue;
				}
				if (closed) {
					return;
				}
				await new Promise<void>((resolve) => {
					waiters.add(resolve);
				});
			}
		},
	};
}

/** Tracks the live TurnChannel for each running session so a reconnecting
 * client can re-attach to the in-flight turn's event stream instead of polling.
 * Single-instance / in-memory (see [[server-runs-in-docker]]): register on turn
 * start, unregister when the pump completes. */
export interface TurnChannelRegistry {
	get(sessionId: string): TurnChannel | undefined;
	register(sessionId: string, channel: TurnChannel): void;
	unregister(sessionId: string): void;
}

export function createTurnChannelRegistry(): TurnChannelRegistry {
	const active = new Map<string, TurnChannel>();
	return {
		get: (sessionId) => active.get(sessionId),
		register(sessionId, channel) {
			active.set(sessionId, channel);
		},
		unregister(sessionId) {
			active.delete(sessionId);
		},
	};
}

/** Consume the turn fully into the channel; never rejects. */
export async function pumpTurn(
	events: AsyncGenerator<RunEvent, unknown>,
	channel: TurnChannel,
	toErrorEvent: (error: unknown) => RunEvent
): Promise<void> {
	try {
		for await (const event of events) {
			channel.push(event);
		}
	} catch (error) {
		channel.push(toErrorEvent(error));
	} finally {
		channel.close();
	}
}
