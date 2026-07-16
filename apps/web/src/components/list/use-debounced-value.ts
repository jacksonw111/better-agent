import { useEffect, useState } from "react";

/** The value, trailing-debounced by `delayMs` — for search inputs that drive
 * server queries, so a query fires per pause instead of per keystroke. */
export function useDebouncedValue<T>(value: T, delayMs: number): T {
	const [debounced, setDebounced] = useState(value);
	useEffect(() => {
		const timer = setTimeout(() => setDebounced(value), delayMs);
		return () => clearTimeout(timer);
	}, [value, delayMs]);
	return debounced;
}
