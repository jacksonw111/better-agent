import { useSyncExternalStore } from "react";

// The ⌘K palette's tiny external store. The palette mounts once in the authed
// shell; a module-level store + useSyncExternalStore lets anything outside the
// React tree above it (e.g. a header button) open it without prop drilling.

interface CommandPaletteState {
	open: boolean;
}

let state: CommandPaletteState = { open: false };
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
