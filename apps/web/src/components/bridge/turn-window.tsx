import { useCallback, useState } from "react";

// The shared transcript-windowing piece: BOTH transcript surfaces — the live
// terminal feed (terminal-feed.tsx) and a prior run's read-only replay
// (tasks/past-run-history.tsx) — mount only a trailing window of turns and
// hide the rest behind a "Show earlier" control. Mounting every turn is what
// made the /tasks chat tab's memory grow linearly with agent output until the
// browser killed it ("Aw, Snap") — first in the live feed, then again in the
// prior-run replay, which is why the logic lives here once instead of being
// copied per surface.

/** How many trailing turns of a transcript stay mounted. Earlier turns hide
 * behind the "Show earlier" control, which reveals one more window per
 * click. */
export const FEED_WINDOW_SIZE = 60;

/** The windowing state for one transcript of `totalCount` turns: how many
 * leading turns are hidden, and the expand step ("Show earlier" reveals one
 * more `FEED_WINDOW_SIZE` per call). Callers render `turns.slice(hiddenCount)`. */
export function useTurnWindow(totalCount: number): {
	hiddenCount: number;
	showEarlier: () => void;
} {
	const [windowSize, setWindowSize] = useState(FEED_WINDOW_SIZE);
	const showEarlier = useCallback(() => {
		setWindowSize((size) => size + FEED_WINDOW_SIZE);
	}, []);
	return { hiddenCount: Math.max(totalCount - windowSize, 0), showEarlier };
}

/** The expand control for the turns hidden above the window — the shared
 * pill button; each surface wraps it in its own scroller/layout item. */
export function ShowEarlierButton({
	hiddenCount,
	onExpand,
}: {
	hiddenCount: number;
	onExpand: () => void;
}) {
	return (
		<div className="flex justify-center py-1">
			<button
				className="rounded-full bg-muted px-4 py-1.5 font-medium text-muted-foreground text-xs transition-colors hover:bg-muted/80 hover:text-foreground"
				onClick={onExpand}
				type="button"
			>
				Show earlier messages（还有 {hiddenCount} 条）
			</button>
		</div>
	);
}
