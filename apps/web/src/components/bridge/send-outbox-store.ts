import { useSyncExternalStore } from "react";

// fix-send-outbox: the failed-send retry/discard actions, published by the
// mounted terminal for the message rows to consume — the same decoupling
// pattern as shell-channel-store.ts.
//
// The alternative was threading two callbacks from `useBridgeTerminal` down
// through Terminal → TerminalBody → TerminalFeed → BridgeChatRow just so a
// failed user bubble can offer "Retry"/"Discard". The DELIVERY STATE itself
// rides the event (see `MessageEvent.sendStatus`) and so reaches the row for
// free; only the two imperative actions need this store. Only one session
// terminal is ever mounted at a time (pane/session switches remount it by
// session id), so a single global channel suffices.

export interface SendOutboxActions {
	/** Drops the failed send for good — its echoed line leaves the feed. */
	discard: (key: string) => void;
	/** Re-queues the failed send under its ORIGINAL idempotency key, so a
	 * message the server had actually received still can't land twice. */
	retry: (key: string) => void;
}

let actions: SendOutboxActions | null = null;
const listeners = new Set<() => void>();

function emit(next: SendOutboxActions | null): void {
	actions = next;
	for (const listener of listeners) {
		listener();
	}
}

/** Publishes the mounted terminal's outbox actions; returns the unregister for
 * the caller's effect cleanup. The cleanup only clears the store when ITS
 * actions are still the live ones, so an unmount racing a fresh publish never
 * wipes the newcomer (mirrors `registerShellChannel`). */
export function registerSendOutboxActions(next: SendOutboxActions): () => void {
	emit(next);
	return () => {
		if (actions === next) {
			emit(null);
		}
	};
}

function subscribe(listener: () => void): () => void {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
}

const getSnapshot = (): SendOutboxActions | null => actions;

/** Imperative read of the current actions (tests, event handlers). */
export function getSendOutboxActions(): SendOutboxActions | null {
	return actions;
}

export function useSendOutboxActions(): SendOutboxActions | null {
	return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
