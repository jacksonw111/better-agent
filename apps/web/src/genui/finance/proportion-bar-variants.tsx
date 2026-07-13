import { cn } from "@better-agent/ui/lib/utils";
import { motion } from "motion/react";
import type {
	ProportionBarProps,
	ProportionBarSegment,
} from "./proportion-bar";
import {
	BarFill,
	fillTransition,
	TRACK_HEIGHT_CLASS,
	toPercent,
} from "./proportion-bar";

// Variant render paths for `ProportionBar` (split out of proportion-bar.tsx to
// keep that file under the line budget as more variants land — see §2
// Primitive Kit for the shapes these cover).
const OVERLAY_FILL_OPACITY = 0.08;

export function SplitTrack({
	reduced,
	segments,
	size,
}: {
	reduced: boolean;
	segments: ProportionBarSegment[];
	size: "sm" | "md";
}) {
	return (
		<div
			className={cn(
				"flex min-w-0 flex-1 overflow-hidden rounded-full bg-muted",
				TRACK_HEIGHT_CLASS[size]
			)}
		>
			{segments.map((segment) => (
				<motion.div
					animate={{ width: `${toPercent(segment.fraction)}%` }}
					className="h-full"
					initial={reduced ? false : { width: 0 }}
					key={segment.key}
					style={{ backgroundColor: segment.color }}
					transition={fillTransition(reduced)}
				/>
			))}
		</div>
	);
}

export type OverlayFillProps = Pick<
	ProportionBarProps,
	"children" | "className" | "direction"
> & {
	color: string;
	percent: number;
	reduced: boolean;
};

export function OverlayFill({
	children,
	className,
	color,
	direction = "start",
	percent,
	reduced,
}: OverlayFillProps) {
	return (
		<div className={cn("relative overflow-hidden", className)}>
			<BarFill
				color={color}
				direction={direction}
				opacity={OVERLAY_FILL_OPACITY}
				percent={percent}
				reduced={reduced}
				rounded={false}
			/>
			{children ? <div className="relative z-10">{children}</div> : null}
		</div>
	);
}
