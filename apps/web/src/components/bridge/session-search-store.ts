import { useSyncExternalStore } from "react";
import type { SessionSearchResult } from "./session-search-events";

// P4-T5: the ⌘K palette's tiny external store for the search channel — same
// decoupling pattern as fs-channel-store.ts / git-channel-store.ts. The
// mounted Terminal owns the session's ONE feed + control channel, so it
// publishes {enabled, search} here (via use-session-search.ts) and the
// palette's content-matches group subscribes — no second SSE connection. Only
// one workspace session terminal is ever mounted at a time, so a single
// global channel suffices.

export interface SessionSearchChannel {
	/** The CLI reported the P4-T5 `sessionOps: "search"` capability on its
	 * handshake — false for an old CLI that can't answer `searchSessions`, so
	 * the palette skips content search instead of hanging requests. */
	enabled: boolean;
	/** Full-text search over the agent's on-disk session transcripts —
	 * requestId-correlated, single reply (see session-search-correlation.ts). */
	search: (query: string) => Promise<SessionSearchResult>;
}

let channel: SessionSearchChannel | null = null;
const listeners = new Set<() => void>();

function emit(next: SessionSearchChannel | null): void {
	channel = next;
	for (const listener of listeners) {
		listener();
	}
}

/** Publishes the mounted terminal's search channel; returns the unregister
 * for the caller's effect cleanup. The cleanup only clears the store when ITS
 * channel is still the live one, so an unmount racing a fresh publish never
 * wipes the newcomer (mirrors `registerGitChannel`). */
export function registerSessionSearchChannel(
	next: SessionSearchChannel
): () => void {
	emit(next);
	return () => {
		if (channel === next) {
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

const getSnapshot = (): SessionSearchChannel | null => channel;

/** Imperative read of the current channel (tests, event handlers). */
export function getSessionSearchChannel(): SessionSearchChannel | null {
	return channel;
}

export function useSessionSearchChannel(): SessionSearchChannel | null {
	return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
