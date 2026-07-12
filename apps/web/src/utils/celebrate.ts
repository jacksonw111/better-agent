import { toast } from "sonner";

// A tasteful confetti burst for genuine "you built/created/connected something"
// moments — NOT for deletions or removals. Two quick side-cannons converging
// toward the top-center, respecting reduced-motion.

const PARTICLE_COUNT = 80;
const SPREAD = 60;
const START_VELOCITY = 45;
const LEFT_ORIGIN = { x: 0.2, y: 0.7 };
const RIGHT_ORIGIN = { x: 0.8, y: 0.7 };

function prefersReducedMotion(): boolean {
	return (
		typeof window !== "undefined" &&
		window.matchMedia("(prefers-reduced-motion: reduce)").matches
	);
}

function celebrate(): void {
	if (prefersReducedMotion()) {
		return;
	}
	// Loaded on demand — confetti is a rare, purely-visual flourish, so keep
	// canvas-confetti out of the eager bundle.
	import("canvas-confetti")
		.then(({ default: confetti }) => {
			confetti({
				particleCount: PARTICLE_COUNT,
				spread: SPREAD,
				startVelocity: START_VELOCITY,
				angle: 60,
				origin: LEFT_ORIGIN,
			});
			confetti({
				particleCount: PARTICLE_COUNT,
				spread: SPREAD,
				startVelocity: START_VELOCITY,
				angle: 120,
				origin: RIGHT_ORIGIN,
			});
		})
		.catch(() => {
			// Confetti is non-essential; ignore load failures.
		});
}

/** Success toast + confetti, for creation/connection successes. */
export function celebrateSuccess(message: string): void {
	celebrate();
	toast.success(message);
}
