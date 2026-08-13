"use client";

import { cn } from "@better-agent/ui/lib/utils";

// Minimal status loader (beautifului.dev "loading-state"): a 3×3 pixel grid
// pulsing in a diagonal wave next to a shimmering label. Pure CSS animation —
// keyframes `pixel-on` and `shimmer-text` live in styles/globals.css and are
// disabled under prefers-reduced-motion.

const GRID_COLS = 3;
const WAVE_STEP_MS = 90;
const PIXEL_CYCLE_MS = 650;
const RESTING_OPACITY = 0.15;

// Row-major 3×3 delays — a wave emanating from the middle row:
// [90,180,270, 0,90,180, 90,180,270].
const CELLS = ["c0", "c1", "c2", "c3", "c4", "c5", "c6", "c7", "c8"].map(
	(id, t) => ({
		id,
		delayMs:
			((t % GRID_COLS) + Math.abs(Math.floor(t / GRID_COLS) - 1)) *
			WAVE_STEP_MS,
	})
);

/** Inline loading indicator: pixel-grid wave + shimmering label. Center it
 * with a flex parent; it only takes the space of its content. */
export function LoadingState({
	className,
	label = "Loading…",
}: {
	className?: string;
	label?: string;
}) {
	return (
		<div
			aria-label={label}
			className={cn("flex w-fit items-center gap-2.5", className)}
			role="status"
		>
			<span aria-hidden className="grid grid-cols-3 gap-px">
				{CELLS.map((cell) => (
					<span
						className="loading-state-pixel size-1 bg-foreground"
						key={cell.id}
						style={{
							opacity: RESTING_OPACITY,
							animation: `pixel-on ${PIXEL_CYCLE_MS}ms ease-in-out ${cell.delayMs}ms infinite`,
						}}
					/>
				))}
			</span>
			<span className="bui-shimmer font-medium text-sm">{label}</span>
		</div>
	);
}
