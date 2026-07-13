import { motion } from "motion/react";
import { changeColor, DOWN_COLOR, UP_COLOR } from "./format";
import { DRAW_IN_MS, EASE_OUT, useReducedMotion } from "./motion";

// Tiny inline trend line for DataTable cells / RankList rows (§2 Primitive
// Kit: Sparkline). Pure SVG polyline — deliberately NOT recharts, which is
// far too heavy to mount once per table row/cell.

const DEFAULT_WIDTH = 64;
const DEFAULT_HEIGHT = 20;
const STROKE_WIDTH = 1.5;
/** Keeps the stroke from clipping at the viewBox edges. */
const EDGE_PADDING = 2;
const AREA_FILL_OPACITY = 0.12;
/** Radius of the single dot rendered for a degenerate 1-value series. */
const DOT_RADIUS = 1.5;
const MS_PER_SECOND = 1000;
/** Line draw-in duration ("柱状生长"-equivalent for a line, §6) — mount only,
 * gated below by `useReducedMotion`. */
const DRAW_IN_SECONDS = DRAW_IN_MS / MS_PER_SECOND;
/** A flat/equal-value series has no meaningful high/low — plot it through
 * the vertical midpoint instead of collapsing to one edge. */
const FLAT_SERIES_RATIO = 0.5;

export type SparklineTone = "up" | "down" | "neutral" | "auto";

export interface SparklineProps {
	className?: string;
	height?: number;
	/** "auto" (default) price-colors by first-vs-last delta via the price
	 * axis; "neutral" and a flat/zero-delta "auto" series render in
	 * `currentColor` (muted) rather than guessing a direction. */
	tone?: SparklineTone;
	values: number[];
	width?: number;
}

function resolveStrokeColor(
	tone: SparklineTone,
	values: number[]
): string | null {
	if (tone === "up") {
		return UP_COLOR;
	}
	if (tone === "down") {
		return DOWN_COLOR;
	}
	if (tone === "neutral") {
		return null;
	}
	const first = values[0];
	const last = values.at(-1) ?? first;
	return changeColor(last - first);
}

interface Extent {
	max: number;
	min: number;
}

function extentOf(values: number[]): Extent {
	let min = values[0];
	let max = values[0];
	for (const v of values) {
		if (v < min) {
			min = v;
		}
		if (v > max) {
			max = v;
		}
	}
	return { max, min };
}

function toPoints(values: number[], width: number, height: number): string {
	const { max, min } = extentOf(values);
	const range = max - min;
	const innerWidth = width - EDGE_PADDING * 2;
	const innerHeight = height - EDGE_PADDING * 2;
	const stepX = values.length > 1 ? innerWidth / (values.length - 1) : 0;
	return values
		.map((v, index) => {
			const x = EDGE_PADDING + index * stepX;
			const ratio = range === 0 ? FLAT_SERIES_RATIO : (v - min) / range;
			const y = EDGE_PADDING + innerHeight * (1 - ratio);
			return `${x},${y}`;
		})
		.join(" ");
}

function toAreaPoints(points: string, width: number, height: number): string {
	const baseline = height - EDGE_PADDING;
	return `${EDGE_PADDING},${baseline} ${points} ${width - EDGE_PADDING},${baseline}`;
}

function SparklineArea({
	color,
	height,
	points,
	width,
}: {
	color: string | null;
	height: number;
	points: string;
	width: number;
}) {
	if (!color) {
		return null;
	}
	return (
		<polygon
			fill={color}
			opacity={AREA_FILL_OPACITY}
			points={toAreaPoints(points, width, height)}
		/>
	);
}

function SparklineLine({
	color,
	points,
	reduced,
}: {
	color: string | null;
	points: string;
	reduced: boolean;
}) {
	const strokeProps = color
		? { stroke: color }
		: { className: "text-muted-foreground", stroke: "currentColor" };
	if (reduced) {
		return (
			<polyline
				fill="none"
				points={points}
				strokeLinecap="round"
				strokeWidth={STROKE_WIDTH}
				{...strokeProps}
			/>
		);
	}
	return (
		<motion.polyline
			animate={{ pathLength: 1 }}
			fill="none"
			initial={{ pathLength: 0 }}
			points={points}
			strokeLinecap="round"
			strokeWidth={STROKE_WIDTH}
			transition={{ duration: DRAW_IN_SECONDS, ease: EASE_OUT }}
			{...strokeProps}
		/>
	);
}

function SparklineDot({
	color,
	height,
	width,
}: {
	color: string | null;
	height: number;
	width: number;
}) {
	const dotProps = color
		? { fill: color }
		: { className: "fill-muted-foreground" };
	return <circle cx={width / 2} cy={height / 2} r={DOT_RADIUS} {...dotProps} />;
}

/** Inline trend line: 0 values render nothing, 1 value renders a centered
 * dot, ≥2 values render a normalized polyline with a soft area fill. */
export function Sparkline({
	className,
	height = DEFAULT_HEIGHT,
	tone = "auto",
	values,
	width = DEFAULT_WIDTH,
}: SparklineProps) {
	const reduced = useReducedMotion() ?? false;
	if (values.length === 0) {
		return null;
	}
	const color = resolveStrokeColor(tone, values);
	if (values.length === 1) {
		return (
			<svg
				aria-hidden="true"
				className={className}
				height={height}
				viewBox={`0 0 ${width} ${height}`}
				width={width}
			>
				<SparklineDot color={color} height={height} width={width} />
			</svg>
		);
	}
	const points = toPoints(values, width, height);
	return (
		<svg
			aria-hidden="true"
			className={className}
			height={height}
			viewBox={`0 0 ${width} ${height}`}
			width={width}
		>
			<SparklineArea
				color={color}
				height={height}
				points={points}
				width={width}
			/>
			<SparklineLine color={color} points={points} reduced={reduced} />
		</svg>
	);
}
