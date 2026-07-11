import { useRef } from "react";
import type { StreamEvent } from "./bridge-events";
import type { BridgeTurn } from "./bridge-turn-types";
import {
	createFoldCursor,
	type FoldCursor,
	foldIncremental,
} from "./fold-cursor";

/**
 * Incrementally folds the bridge event feed into renderable turns — replaces
 * `useMemo(() => foldEventsToTurns(events), [events])`, which re-folded the
 * ENTIRE session on every streamed token (O(n²) total work over a long
 * session). A `FoldCursor` persists in a ref across renders and folds only
 * the events appended since the last render; see fold-cursor.ts for the
 * reset-detection and turn-identity rules.
 */
export function useFoldedTurns(events: StreamEvent[]): BridgeTurn[] {
	const cursorRef = useRef<FoldCursor | null>(null);
	if (!cursorRef.current) {
		cursorRef.current = createFoldCursor();
	}
	return foldIncremental(cursorRef.current, events);
}
