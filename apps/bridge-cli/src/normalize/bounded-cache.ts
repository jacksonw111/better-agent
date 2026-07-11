// A handful of adapters need to remember something about an in-flight tool
// call (its name, its start time…) between two separate wire lines that
// share only an id — e.g. pi's `tool_execution_update` carries no `toolName`
// of its own, only `toolCallId` (see normalize/pi.ts). A plain `Map` would
// leak forever if the matching "end" line never arrives (an interrupted
// turn, a malformed id, a protocol drift); this caps the size instead,
// evicting the OLDEST entry — `Map` iteration order is insertion order — so
// memory stays bounded across an arbitrarily long session.

const DEFAULT_MAX_ENTRIES = 500;

export interface BoundedCache<V> {
	delete(key: string): void;
	get(key: string): V | undefined;
	set(key: string, value: V): void;
}

export function createBoundedCache<V>(
	maxEntries: number = DEFAULT_MAX_ENTRIES
): BoundedCache<V> {
	const entries = new Map<string, V>();
	return {
		delete(key: string): void {
			entries.delete(key);
		},
		get(key: string): V | undefined {
			return entries.get(key);
		},
		set(key: string, value: V): void {
			if (!entries.has(key) && entries.size >= maxEntries) {
				const oldest = entries.keys().next().value;
				if (oldest !== undefined) {
					entries.delete(oldest);
				}
			}
			entries.set(key, value);
		},
	};
}
