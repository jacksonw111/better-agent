import { motion } from "motion/react";
import type { ReactNode } from "react";
import { cn } from "../lib/cn";
import { POP_TRANSITION, useReducedMotion } from "./motion";

// Phase 0 Task E — `Chip`, the secondary (right) control of the shared
// `ControlStrip` (design doc §3 "metric chips" — Series/Filter). Presentational
// + controlled: reports toggles up to the caller's `useSeriesSelect`/`useFilter`
// hook (Task D) rather than owning selection state.

/** ≥44px touch target floor (spec §7); `h-11` = 44px on the default Tailwind
 * 4px scale. */
const MIN_TOUCH_CLASS = "min-h-11";
/** ~15% alpha suffix for an active chip's `tone`-tinted background, matching
 * VerdictPill's tint approach at a slightly stronger alpha (chips need to
 * read as "on" at a glance, at chip scale). */
const TONE_BG_ALPHA_HEX = "26";
const POP_SCALE = 1.03;

export interface ChipProps {
	active: boolean;
	className?: string;
	disabled?: boolean;
	label: ReactNode;
	/** Set for chips whose label is a formatted number, to keep digits
	 * aligned across a chip row (spec §5.4 "所有数字 tabular-nums"). */
	numeric?: boolean;
	onToggle: () => void;
	/** Optional series color (e.g. a metric's chart color) tinting the active
	 * state instead of the default accent fill. */
	tone?: string;
}

function chipClassName(opts: {
	active: boolean;
	className?: string;
	disabled: boolean;
	numeric: boolean;
	tone?: string;
}): string {
	const { active, className, disabled, numeric, tone } = opts;
	const usesAccentFill = active && !tone && !disabled;
	const isMuted = !(active || disabled);
	return cn(
		"flex shrink-0 items-center justify-center whitespace-nowrap rounded-full px-3 font-medium text-xs transition-colors",
		MIN_TOUCH_CLASS,
		numeric && "tabular-nums",
		disabled && "cursor-not-allowed opacity-40",
		!disabled && "active:scale-[0.98]",
		usesAccentFill && "bg-primary text-primary-foreground",
		isMuted && "bg-muted/40 text-muted-foreground",
		className
	);
}

function chipToneStyle(
	active: boolean,
	disabled: boolean,
	tone?: string
): { backgroundColor: string; color: string } | undefined {
	const usesTone = active && !disabled && tone;
	return usesTone
		? { backgroundColor: `${tone}${TONE_BG_ALPHA_HEX}`, color: tone }
		: undefined;
}

/** A toggle chip (Series/Filter) — right slot of the `ControlStrip`. Active
 * = filled tint (accent, or `tone` when given); inactive = muted. Borderless,
 * ≥44px tap target, press-scale + spring pop, reduced-motion respected. */
export function Chip({
	active,
	className,
	disabled = false,
	label,
	onToggle,
	tone,
	numeric = false,
}: ChipProps) {
	const reduced = useReducedMotion() ?? false;

	return (
		<button
			aria-pressed={active}
			className={chipClassName({ active, className, disabled, numeric, tone })}
			disabled={disabled}
			onClick={onToggle}
			style={chipToneStyle(active, disabled, tone)}
			type="button"
		>
			<motion.span
				animate={active && !reduced ? { scale: [1, POP_SCALE, 1] } : undefined}
				transition={reduced ? { duration: 0 } : POP_TRANSITION}
			>
				{label}
			</motion.span>
		</button>
	);
}
