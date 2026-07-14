import { useSyncExternalStore } from "react";

// P2-T4 (docs/local-agent-workspace-plan.md): typed, localStorage-backed
// client preferences, reactive across components via `useClientPref` +
// `useSyncExternalStore`. Storage is read on every snapshot (the values are
// boolean primitives, so snapshots stay referentially stable without a
// cache), which keeps the module stateless apart from its listener set —
// tests only need `localStorage.clear()`. Theme deliberately stays in
// `utils/theme.ts` (it predates this module and has its own FOUC script);
// QuickSettings just calls the existing toggle.

export type ClientPrefKey =
	| "sendByCtrlEnter"
	| "showRawParameters"
	| "showThinking";

const PREF_DEFAULTS: Record<ClientPrefKey, boolean> = {
	sendByCtrlEnter: false,
	showRawParameters: false,
	showThinking: true,
};

const STORAGE_PREFIX = "ba:pref:";

function storageKey(key: ClientPrefKey): string {
	return `${STORAGE_PREFIX}${key}`;
}

const listeners = new Set<() => void>();

function emit(): void {
	for (const listener of listeners) {
		listener();
	}
}

/** Another tab changed a pref (or cleared storage entirely, key === null) —
 * re-read and re-render the subscribers here too. */
function onStorage(event: StorageEvent): void {
	if (event.key === null || event.key.startsWith(STORAGE_PREFIX)) {
		emit();
	}
}

/**
 * Current value of a pref: the persisted value when present and well-formed
 * ("true"/"false" exactly), the built-in default otherwise — including under
 * SSR (no `window`), when storage access throws (privacy modes), and for
 * corrupt/legacy values.
 */
export function getClientPref(key: ClientPrefKey): boolean {
	if (typeof window === "undefined") {
		return PREF_DEFAULTS[key];
	}
	try {
		const raw = window.localStorage.getItem(storageKey(key));
		if (raw === "true" || raw === "false") {
			return raw === "true";
		}
		return PREF_DEFAULTS[key];
	} catch {
		return PREF_DEFAULTS[key];
	}
}

/** Persists a pref and notifies every subscribed component in this tab. */
export function setClientPref(key: ClientPrefKey, value: boolean): void {
	try {
		window.localStorage.setItem(storageKey(key), String(value));
	} catch {
		// Storage unavailable (SSR/privacy mode/quota): the write is lost, but
		// notifying is still harmless — snapshots just keep the default.
	}
	emit();
}

/** Subscribes to pref changes (module-level, shared by all `useClientPref`
 * instances). The cross-tab storage listener is attached only while there is
 * at least one subscriber. */
export function subscribeClientPrefs(listener: () => void): () => void {
	if (listeners.size === 0 && typeof window !== "undefined") {
		window.addEventListener("storage", onStorage);
	}
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
		if (listeners.size === 0 && typeof window !== "undefined") {
			window.removeEventListener("storage", onStorage);
		}
	};
}

/** Reactive read of one client pref — re-renders on `setClientPref` from
 * anywhere in this tab (and on cross-tab storage events). */
export function useClientPref(key: ClientPrefKey): boolean {
	return useSyncExternalStore(
		subscribeClientPrefs,
		() => getClientPref(key),
		() => PREF_DEFAULTS[key]
	);
}
