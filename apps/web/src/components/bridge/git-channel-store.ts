import { useSyncExternalStore } from "react";
import type {
	GitCommitResult,
	GitDiffResult,
	GitStatusResult,
} from "./git-events";

// P4-T4: the workspace Git tab's tiny external store — same decoupling
// pattern as fs-channel-store.ts. The mounted Terminal owns the session's ONE
// feed + control channel, so it publishes {enabled, status, diff, commit}
// here (via use-git-channel.ts) and the Git pane subscribes — no second SSE
// connection. Only one workspace session terminal is ever mounted at a time,
// so a single global channel suffices.

export interface GitChannel {
	/** v1 commits ALL working-tree changes (`git add -A` CLI-side) — the pane's
	 * button says so. Resolves with the new commit's short hash. */
	commit: (message: string) => Promise<GitCommitResult>;
	/** Staged+unstaged unified diff — the whole tree, or one workspace-relative
	 * `path`. Chunk-reassembled, size-capped (marked `truncated`). */
	diff: (path?: string) => Promise<GitDiffResult>;
	/** The CLI reported the P4-T4 `git` capability on its handshake — false for
	 * an old CLI that can't answer the git commands, so the pane shows an
	 * upgrade hint instead of hanging requests. */
	enabled: boolean;
	/** Branch + porcelain entries summary (`notARepo: true` when the workspace
	 * isn't a git repo). */
	status: () => Promise<GitStatusResult>;
}

let channel: GitChannel | null = null;
const listeners = new Set<() => void>();

function emit(next: GitChannel | null): void {
	channel = next;
	for (const listener of listeners) {
		listener();
	}
}

/** Publishes the mounted terminal's git channel; returns the unregister for
 * the caller's effect cleanup. The cleanup only clears the store when ITS
 * channel is still the live one, so an unmount racing a fresh publish never
 * wipes the newcomer (mirrors `registerFsChannel`). */
export function registerGitChannel(next: GitChannel): () => void {
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

const getSnapshot = (): GitChannel | null => channel;

/** Imperative read of the current channel (tests, event handlers). */
export function getGitChannel(): GitChannel | null {
	return channel;
}

export function useGitChannel(): GitChannel | null {
	return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
