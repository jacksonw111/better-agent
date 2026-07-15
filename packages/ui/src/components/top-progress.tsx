import { useEffect, useRef, useState } from "react";

const INITIAL_PCT = 8;
const TARGET_PCT = 90;
const FULL_PCT = 100;
const TRICKLE_MS = 300;
const TRICKLE_RATE = 0.12;
const HIDE_MS = 350;

/**
 * Fixed top loading bar. Fills left→right while `active`: jumps in, trickles
 * toward 90%, then snaps to 100% and fades out when loading finishes. A real
 * progress bar — it moves forward, not an endless sweep.
 */
export function TopProgress({ active }: { active: boolean }) {
	const [pct, setPct] = useState(0);
	const [visible, setVisible] = useState(false);
	const tick = useRef<ReturnType<typeof setInterval> | null>(null);

	useEffect(() => {
		if (active) {
			setVisible(true);
			setPct((p) => (p < INITIAL_PCT ? INITIAL_PCT : p));
			tick.current = setInterval(() => {
				setPct((p) =>
					p >= TARGET_PCT ? p : p + (TARGET_PCT - p) * TRICKLE_RATE
				);
			}, TRICKLE_MS);
			return () => {
				if (tick.current) {
					clearInterval(tick.current);
				}
			};
		}
		if (tick.current) {
			clearInterval(tick.current);
		}
		setPct(FULL_PCT);
		const hide = setTimeout(() => {
			setVisible(false);
			setPct(0);
		}, HIDE_MS);
		return () => clearTimeout(hide);
	}, [active]);

	if (!visible) {
		return null;
	}
	return (
		<div
			aria-hidden="true"
			className="pointer-events-none fixed inset-x-0 top-0 z-50 h-0.5"
		>
			{/* scaleX (not width): transform+opacity stay on the GPU, so the bar
			    keeps moving while the main thread is busy loading the page. */}
			<div
				className="h-full origin-left bg-foreground transition duration-300 ease-out"
				style={{
					transform: `scaleX(${pct / FULL_PCT})`,
					opacity: pct >= FULL_PCT ? 0 : 1,
				}}
			/>
		</div>
	);
}
