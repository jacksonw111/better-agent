import { cn } from "@better-agent/ui/lib/utils";
import { motion } from "motion/react";
import type { ReactNode } from "react";
import { PROBABILITY, SENTIMENT_NEUTRAL } from "./chart-theme";
import { DOWN_COLOR, UP_COLOR } from "./format";
import { DRAW_IN_MS, EASE_OUT, useReducedMotion } from "./motion";
import { OverlayFill, SplitTrack } from "./proportion-bar-variants";

// One proportional-bar primitive covering every finance-genui bar shape (§2
// Primitive Kit): depth-ladder overlay, bull/bear split, odds bar, hue-ramp rows.
const PERCENT_MAX = 100;
const MS_PER_SECOND = 1000;
/** Bar width first-draw duration ("柱状生长" §6). `animate` always targets the
 * latest `percent` without resetting to 0, so re-slicing re-sizes smoothly
 * instead of replaying a from-zero draw (§6 Guardrail 1). */
const DRAW_IN_SECONDS = DRAW_IN_MS / MS_PER_SECOND;
const INSTANT_SECONDS = 0;
const LABEL_CLASS = "w-20 shrink-0 truncate text-muted-foreground text-xs";
const VALUE_LABEL_CLASS =
	"w-12 shrink-0 text-right font-medium text-xs tabular-nums";

export const TRACK_HEIGHT_CLASS: Record<"sm" | "md", string> = {
	md: "h-2",
	sm: "h-1.5",
};

export type ProportionBarTone = "up" | "down" | "probability" | "neutral";

const TONE_COLOR: Record<ProportionBarTone, string> = {
	down: DOWN_COLOR,
	neutral: SENTIMENT_NEUTRAL,
	probability: PROBABILITY,
	up: UP_COLOR,
};

function resolveColor(tone?: ProportionBarTone, color?: string): string {
	if (color) {
		return color;
	}
	return TONE_COLOR[tone ?? "neutral"];
}

function toFraction(fraction?: number, value?: number, max?: number): number {
	if (fraction !== undefined) {
		return fraction;
	}
	if (value !== undefined && max !== undefined && max > 0) {
		return value / max;
	}
	return 0;
}

export function toPercent(fraction: number): number {
	if (!Number.isFinite(fraction)) {
		return 0;
	}
	return Math.min(Math.max(fraction, 0), 1) * PERCENT_MAX;
}

/** One segment of a split-mode bar (e.g. bull/bear); `fraction` is 0..1 of the track's total width. */
export interface ProportionBarSegment {
	color: string;
	fraction: number;
	key: string;
}

export interface ProportionBarProps {
	/** Overlay content drawn above the fill (variant="overlay" only). */
	children?: ReactNode;
	className?: string;
	/** Explicit hex, overrides `tone` (e.g. `compositionHueRamp()` rows). */
	color?: string;
	/** Edge the fill grows from — depth ladders grow bids/asks opposite. */
	direction?: "start" | "end";
	/** Single-value mode: 0..1. Use this OR `value`+`max`, not both. */
	fraction?: number;
	label?: ReactNode;
	max?: number;
	/** Split mode: N segments sharing one track. Mutually exclusive with `fraction`/`value`/`tone`/`color`. */
	segments?: ProportionBarSegment[];
	size?: "sm" | "md";
	tone?: ProportionBarTone;
	value?: number;
	valueLabel?: ReactNode;
	/** "track": muted pill track behind the fill. "overlay": fill sits behind `children` at low alpha. */
	variant?: "track" | "overlay";
}

export function fillTransition(reduced: boolean) {
	return {
		duration: reduced ? INSTANT_SECONDS : DRAW_IN_SECONDS,
		ease: EASE_OUT,
	};
}

export function BarFill({
	color,
	direction,
	opacity,
	percent,
	reduced,
	rounded,
}: {
	color: string;
	direction: "start" | "end";
	opacity?: number;
	percent: number;
	reduced: boolean;
	rounded: boolean;
}) {
	const className = cn(
		"absolute inset-y-0",
		direction === "end" ? "right-0" : "left-0",
		rounded && "rounded-full"
	);
	return (
		<motion.div
			animate={{ width: `${percent}%` }}
			className={className}
			initial={reduced ? false : { width: 0 }}
			style={{ backgroundColor: color, opacity }}
			transition={fillTransition(reduced)}
		/>
	);
}

function BarLabel({ children }: { children: ReactNode }) {
	return <span className={LABEL_CLASS}>{children}</span>;
}

function BarValueLabel({ children }: { children: ReactNode }) {
	return <span className={VALUE_LABEL_CLASS}>{children}</span>;
}

type TrackBarProps = Pick<
	ProportionBarProps,
	"className" | "direction" | "label" | "segments" | "size" | "valueLabel"
> & {
	color: string;
	percent: number;
	reduced: boolean;
};

function TrackBar({
	className,
	color,
	direction = "start",
	label,
	percent,
	reduced,
	segments,
	size = "sm",
	valueLabel,
}: TrackBarProps) {
	return (
		<div className={cn("flex items-center gap-2", className)}>
			{label === undefined ? null : <BarLabel>{label}</BarLabel>}
			{segments ? (
				<SplitTrack reduced={reduced} segments={segments} size={size} />
			) : (
				<div
					className={cn(
						"relative min-w-0 flex-1 overflow-hidden rounded-full bg-muted",
						TRACK_HEIGHT_CLASS[size]
					)}
				>
					<BarFill
						color={color}
						direction={direction}
						percent={percent}
						reduced={reduced}
						rounded
					/>
				</div>
			)}
			{valueLabel === undefined ? null : (
				<BarValueLabel>{valueLabel}</BarValueLabel>
			)}
		</div>
	);
}

/** Shared proportional-bar primitive — see the module comment for the four call sites this generalizes. */
export function ProportionBar({
	children,
	className,
	color,
	direction = "start",
	fraction,
	label,
	max,
	segments,
	size = "sm",
	tone,
	value,
	valueLabel,
	variant = "track",
}: ProportionBarProps) {
	const reduced = useReducedMotion() ?? false;
	const percent = toPercent(toFraction(fraction, value, max));
	const resolved = resolveColor(tone, color);

	if (variant === "overlay") {
		return (
			<OverlayFill
				className={className}
				color={resolved}
				direction={direction}
				percent={percent}
				reduced={reduced}
			>
				{children}
			</OverlayFill>
		);
	}

	return (
		<TrackBar
			className={className}
			color={resolved}
			direction={direction}
			label={label}
			percent={percent}
			reduced={reduced}
			segments={segments}
			size={size}
			valueLabel={valueLabel}
		/>
	);
}
