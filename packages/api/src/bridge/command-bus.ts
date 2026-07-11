// In-process pub/sub that tells a live bridge WS connection "there's a new
// command for this session, go read it" — the WS handler (see ws-session.ts)
// reacts by re-reading `relayStore` for anything past its own last-sent id
// and pushing it as `command` frames. Deliberately NOT built on RelayStore's
// own `subscribe` (which forwards the actual payload): CommandBus only ever
// carries a "something changed" bell, so a connection's read-then-send stays
// entirely under its own serialization (see ws-session.ts's command pump) and
// never races an event object arriving out of order with a replay.
//
// Plain Map<string, Set<fn>> — deliberately not an EventEmitter (no need for
// its extra surface: error-event semantics, max-listener warnings, etc. for
// what's just "call every registered fn for this key").
export interface CommandBus {
	/** Wakes every subscriber currently registered for `sessionId`. Never
	 * throws — a subscriber callback that throws is swallowed so one bad
	 * connection can't break notification to the others. */
	notify(sessionId: string): void;
	/** Registers `fn` to be called on every `notify(sessionId)` until the
	 * returned unsubscribe function runs. */
	subscribe(sessionId: string, fn: () => void): () => void;
}

export function createCommandBus(): CommandBus {
	const subscribersBySession = new Map<string, Set<() => void>>();

	return {
		subscribe(sessionId, fn) {
			let subscribers = subscribersBySession.get(sessionId);
			if (!subscribers) {
				subscribers = new Set();
				subscribersBySession.set(sessionId, subscribers);
			}
			subscribers.add(fn);
			return () => {
				subscribers?.delete(fn);
				if (subscribers?.size === 0) {
					subscribersBySession.delete(sessionId);
				}
			};
		},
		notify(sessionId) {
			const subscribers = subscribersBySession.get(sessionId);
			if (!subscribers) {
				return;
			}
			for (const fn of subscribers) {
				try {
					fn();
				} catch {
					// swallow — see CommandBus.notify's doc comment.
				}
			}
		},
	};
}
