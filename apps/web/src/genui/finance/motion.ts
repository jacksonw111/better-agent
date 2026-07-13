// Shared motion vocabulary for the genui finance renderers. Pure module (no
// JSX) so every finance component pulls animation timing/easing from here
// instead of hardcoding it — mirrors how `format.ts` is the single source
// for number formatting. See docs/design/finance-genui-redesign.md §6 for
// the animation inventory and the three guardrails this module encodes:
//   1. filter/re-slice updates are instant — components must gate entrance
//      and draw-in animations behind "first mount" / "explicit view change",
//      never behind a data re-slice.
//   2. odometer only ever wraps aggregate headline numbers, never table cells.
//   3. prefers-reduced-motion drops transform/scale/stagger, keeps opacity —
//      the `reduced` argument on every factory below is how callers honor it.
import type { Transition, Variants } from "motion/react";

// biome-ignore lint/performance/noBarrelFile: single re-export site so finance components import useReducedMotion from this token module instead of motion/react directly.
export { useReducedMotion } from "motion/react";

/** Press feedback on any clickable element (~100ms per §6). */
export const PRESS_MS = 100;
/** Row/tile hover tint lift (~120ms per §6). */
export const HOVER_MS = 120;
/** Card fade + translateY entrance (~200ms per §6). */
export const ENTRANCE_MS = 200;
/** Table⇄chart morph / row expand crossfade (~200ms per §6). */
export const TRANSITION_MS = 200;
/** Chart first-draw line/bar growth (~400ms per §6). */
export const DRAW_IN_MS = 400;
/** Per-row stagger delay in list/table cascades (~30ms per §6). */
export const ROW_STAGGER_MS = 30;
/** Selection "pop" tween duration (1 → 1.03 → 1) on chip/segment select. */
export const POP_MS = 200;

/** Vertical offset a card travels on entrance, in px (§6: translateY 6px→0). */
const ENTRANCE_TRANSLATE_Y = 6;

// Cubic-bezier control points for EASE_OUT below (a standard "ease-out
// expo-ish" curve: fast start, gentle settle).
const EASE_OUT_X1 = 0.22;
const EASE_OUT_Y1 = 1;
const EASE_OUT_X2 = 0.36;
const EASE_OUT_Y2 = 1;

/** Ease-out cubic-bezier used for entrance/expand transitions. */
export const EASE_OUT: Transition["ease"] = [
	EASE_OUT_X1,
	EASE_OUT_Y1,
	EASE_OUT_X2,
	EASE_OUT_Y2,
];

/** Spring config for single-target layout/settle animations — e.g. the
 * segmented control's sliding indicator (`layoutId`). Values chosen for a
 * snappy, slightly overshooting settle that reads as "individual" per the
 * §6 "丰富而有个性" (rich, has personality) directive without feeling
 * bouncy/toy-like. `motion` springs only support two keyframes, so this
 * must NOT be used for the three-keyframe scale pop below. */
export const SPRING_POP: Transition = {
	type: "spring",
	stiffness: 500,
	damping: 15,
	mass: 0.5,
};

const MS_PER_S = 1000;
const entranceSeconds = ENTRANCE_MS / MS_PER_S;
const staggerSeconds = ROW_STAGGER_MS / MS_PER_S;
const popSeconds = POP_MS / MS_PER_S;

/** Tween for the selection "pop" (1 → 1.03 → 1) on chip/segment select — a
 * three-keyframe scale animation, which `motion` springs cannot express
 * (springs support exactly two keyframes). Ease-out in, ease-out back per
 * `times` so the overshoot settles rather than snapping. */
export const POP_TRANSITION: Transition = {
	duration: popSeconds,
	times: [0, 0.5, 1],
	ease: EASE_OUT,
};

/** Card entrance: fade + translateY 6px→0, ~200ms ease-out. Pass
 * `reduced = true` (from `useReducedMotion()`) to drop the transform and
 * animate opacity only, per Guardrail 3. */
export function entranceVariants(reduced: boolean): Variants {
	if (reduced) {
		return {
			hidden: { opacity: 0 },
			visible: { opacity: 1, transition: { duration: entranceSeconds } },
		};
	}
	return {
		hidden: { opacity: 0, y: ENTRANCE_TRANSLATE_Y },
		visible: {
			opacity: 1,
			y: 0,
			transition: { duration: entranceSeconds, ease: EASE_OUT },
		},
	};
}

/** Stagger container for list/table row cascades. Children should use
 * `rowItemVariants`. `reduced = true` disables the stagger so every row
 * animates in together (opacity only). */
export function staggerContainerVariants(reduced: boolean): Variants {
	if (reduced) {
		return {
			hidden: {},
			visible: { transition: { staggerChildren: 0 } },
		};
	}
	return {
		hidden: {},
		visible: { transition: { staggerChildren: staggerSeconds } },
	};
}

/** A single row/tile inside a `staggerContainerVariants` cascade: fade +
 * translateY 6px→0 per row, ease-out. `reduced = true` drops the transform. */
export function rowItemVariants(reduced: boolean): Variants {
	if (reduced) {
		return {
			hidden: { opacity: 0 },
			visible: { opacity: 1 },
		};
	}
	return {
		hidden: { opacity: 0, y: ENTRANCE_TRANSLATE_Y },
		visible: { opacity: 1, y: 0, transition: { ease: EASE_OUT } },
	};
}
