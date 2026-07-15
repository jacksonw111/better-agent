import { useSyncExternalStore } from "react";
import type { StreamEvent } from "./bridge-events";

// P4-T2 (docs/local-agent-workspace-plan.md): the workspace Shell tab's tiny
// external store — the same decoupling pattern as command-palette-store.ts.
// The Shell pane lives ABOVE the terminal in the tab row, but the terminal
// (inside the kept-alive chat pane) is the one thing that owns the session's
// event feed AND the `runShell` control. Rather than open a SECOND SSE
// connection for the pane, the mounted Terminal publishes {run, events,
// enabled} here off its ONE feed; the Shell pane subscribes. Only one
// workspace session terminal is ever mounted at a time (the pane switches
// remount the terminal by session id), so a single global channel suffices.

export interface ShellChannel {
	/** The CLI reported the P4-T2 `shell` capability on its handshake — false
	 * for an old CLI that can't answer `runShell`, so the pane shows an
	 * upgrade hint instead of silently swallowing commands. */
	enabled: boolean;
	/** runShell tool events (source === "runShell") pulled from the terminal's
	 * feed, in feed order — the Shell pane folds these into command cards. */
	events: StreamEvent[];
	/** Runs one command in the agent's workspace (routes the `runShell` control
	 * command). Output arrives asynchronously on `events`. */
	run: (command: string) => Promise<void>;
}

let channel: ShellChannel | null = null;
const listeners = new Set<() => void>();

function emit(next: ShellChannel | null): void {
	channel = next;
	for (const listener of listeners) {
		listener();
	}
}

/** Publishes the mounted terminal's shell channel; returns the unregister for
 * the caller's effect cleanup. The cleanup only clears the store when ITS
 * channel is still the live one, so an unmount racing a fresh publish never
 * wipes the newcomer (mirrors `registerWorkspaceCommandTarget`). */
export function registerShellChannel(next: ShellChannel): () => void {
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

const getSnapshot = (): ShellChannel | null => channel;

/** Imperative read of the current channel (tests, event handlers). */
export function getShellChannel(): ShellChannel | null {
	return channel;
}

export function useShellChannel(): ShellChannel | null {
	return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
