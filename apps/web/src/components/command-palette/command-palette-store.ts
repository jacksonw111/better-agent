import { useSyncExternalStore } from "react";
import type { WorkspaceTabId } from "@/components/bridge/local-agent-workspace-tabs";

// P2-T3 (docs/local-agent-workspace-plan.md): the ⌘K palette's tiny external
// store. The palette mounts once in the authed shell, but two things outside
// the React tree above it need to reach it: the workspace header's "⌘K"
// button (open) and the /local/$tokenId workspace (its tab state + settings
// opener, so palette items can act on the CURRENT workspace without lifting
// that state out of the route — lifting would risk remounting the kept-alive
// chat pane). A module-level store + useSyncExternalStore keeps both sides
// decoupled and the chat pane untouched.

/** What a mounted /local/$tokenId workspace exposes to the palette. */
export interface WorkspaceCommandTarget {
	/** Opens the agent-settings dialog the workspace lazily mounts. */
	openSettings: () => void;
	setTab: (tab: WorkspaceTabId) => void;
	tab: WorkspaceTabId;
	tokenId: string;
}

interface CommandPaletteState {
	open: boolean;
	/** The currently mounted workspace, or null outside /local/$tokenId. */
	workspace: WorkspaceCommandTarget | null;
}

let state: CommandPaletteState = { open: false, workspace: null };
const listeners = new Set<() => void>();

function emit(next: CommandPaletteState): void {
	state = next;
	for (const listener of listeners) {
		listener();
	}
}

export function setCommandPaletteOpen(open: boolean): void {
	if (state.open !== open) {
		emit({ ...state, open });
	}
}

export function toggleCommandPalette(): void {
	emit({ ...state, open: !state.open });
}

/** Registers the mounted workspace as the palette's action target; returns
 * the unregister for the caller's effect cleanup. Re-registering (e.g. on a
 * tab change) just replaces the snapshot; the cleanup only clears the store
 * when ITS registration is still the live one, so an unmount racing a fresh
 * register never wipes the newcomer. */
export function registerWorkspaceCommandTarget(
	target: WorkspaceCommandTarget
): () => void {
	emit({ ...state, workspace: target });
	return () => {
		if (state.workspace === target) {
			emit({ ...state, workspace: null });
		}
	};
}

function subscribe(listener: () => void): () => void {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
}

const getSnapshot = (): CommandPaletteState => state;

/** Imperative read of the current palette state (tests, event handlers). */
export function getCommandPaletteState(): CommandPaletteState {
	return state;
}

export function useCommandPaletteState(): CommandPaletteState {
	return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
