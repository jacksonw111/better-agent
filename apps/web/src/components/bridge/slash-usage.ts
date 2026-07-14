// P2-T5: per-browser usage counts for the composer's "/" picker, so the
// items the owner actually uses float to the top of their group (see
// `buildSlashPickerItems`'s usage-aware sort). Plain localStorage under one
// JSON key — NOT part of utils/preferences.ts, which is a boolean-pref store
// (`ba:pref:*`); a name→count map doesn't fit its shape and needs no
// cross-component reactivity (the picker re-reads on every open).

const STORAGE_KEY = "ba:slash-usage";

/** Stored entries are pruned down to this many (dropping the LOWEST counts)
 * whenever a record pushes the map past it — keeps the blob bounded even for
 * an owner who cycles through many one-off commands. */
export const MAX_SLASH_USAGE_ENTRIES = 50;

function isCountRecord(value: unknown): value is Record<string, number> {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		return false;
	}
	return Object.values(value).every(
		(count) => typeof count === "number" && Number.isFinite(count)
	);
}

/**
 * The persisted name→count map — `{}` under SSR (no `window`), when storage
 * access throws (privacy modes), or for corrupt/legacy JSON, mirroring
 * `getClientPref`'s "trust nothing in storage" degrade.
 */
export function readSlashUsage(): Record<string, number> {
	if (typeof window === "undefined") {
		return {};
	}
	try {
		const raw = window.localStorage.getItem(STORAGE_KEY);
		if (raw === null) {
			return {};
		}
		const parsed: unknown = JSON.parse(raw);
		return isCountRecord(parsed) ? parsed : {};
	} catch {
		return {};
	}
}

/** The `counts` entries capped at `MAX_SLASH_USAGE_ENTRIES` by dropping the
 * lowest counts first — exported for direct unit-testing of the prune rule. */
export function pruneSlashUsage(
	counts: Record<string, number>
): Record<string, number> {
	const entries = Object.entries(counts);
	if (entries.length <= MAX_SLASH_USAGE_ENTRIES) {
		return counts;
	}
	entries.sort((a, b) => b[1] - a[1]);
	return Object.fromEntries(entries.slice(0, MAX_SLASH_USAGE_ENTRIES));
}

/** Bumps `name`'s use count by one and persists, pruning the lowest-count
 * entries past the cap. Write failures (SSR/privacy mode/quota) are swallowed
 * — losing a frequency bump is harmless. */
export function recordSlashUsage(name: string): void {
	const counts = readSlashUsage();
	counts[name] = (counts[name] ?? 0) + 1;
	try {
		window.localStorage.setItem(
			STORAGE_KEY,
			JSON.stringify(pruneSlashUsage(counts))
		);
	} catch {
		// Storage unavailable: the bump is lost, but the picker still works
		// (it just keeps the agent-reported order).
	}
}
