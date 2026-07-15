import { useSyncExternalStore } from "react";
import type { FsListResult, FsReadResult } from "./fs-correlation";

// P4-T3: the workspace Files tab's tiny external store — same decoupling
// pattern as shell-channel-store.ts. The mounted Terminal owns the session's
// ONE feed + control channel, so it publishes {enabled, list, read} here (via
// use-fs-channel.ts) and the Files pane / composer @file picker subscribe —
// no second SSE connection. Only one workspace session terminal is ever
// mounted at a time, so a single global channel suffices.

export interface FsChannel {
	/** The CLI reported the P4-T3 `fs` capability on its handshake — false for
	 * an old CLI that can't answer `fsList`/`fsRead`, so the pane shows an
	 * upgrade hint instead of hanging requests. */
	enabled: boolean;
	/** Lists one workspace directory (path workspace-relative; omitted = the
	 * root). Resolves/rejects via requestId correlation — see
	 * fs-correlation.ts. */
	list: (path?: string) => Promise<FsListResult>;
	/** Reads one workspace file (size-capped, chunk-reassembled, binary flagged
	 * instead of content). */
	read: (path: string) => Promise<FsReadResult>;
}

let channel: FsChannel | null = null;
const listeners = new Set<() => void>();

function emit(next: FsChannel | null): void {
	channel = next;
	for (const listener of listeners) {
		listener();
	}
}

/** Publishes the mounted terminal's fs channel; returns the unregister for
 * the caller's effect cleanup. The cleanup only clears the store when ITS
 * channel is still the live one, so an unmount racing a fresh publish never
 * wipes the newcomer (mirrors `registerShellChannel`). */
export function registerFsChannel(next: FsChannel): () => void {
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

const getSnapshot = (): FsChannel | null => channel;

/** Imperative read of the current channel (tests, event handlers). */
export function getFsChannel(): FsChannel | null {
	return channel;
}

export function useFsChannel(): FsChannel | null {
	return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
