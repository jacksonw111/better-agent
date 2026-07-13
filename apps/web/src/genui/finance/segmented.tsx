import { cn } from "@better-agent/ui/lib/utils";
import { motion } from "motion/react";
import type { ReactNode } from "react";
import { useId } from "react";
import { POP_TRANSITION, SPRING_POP, useReducedMotion } from "./motion";

// Phase 0 Task E — `Segmented`, the primary (left) control of the shared
// `ControlStrip` (design doc §3 "主 segmented: Period / Pivot"). Presentational
// + controlled: it renders the segmented-control UI and reports selection
// changes up to the caller's interaction hook (usePeriod/usePivot from Task
// D) — it never owns selection state itself.

/** ≥44px touch target floor (spec §7 "tap 目标 ≥44px"); `h-11` = 44px on the
 * default Tailwind 4px scale. */
const MIN_TOUCH_CLASS = "min-h-11";
const POP_SCALE = 1.03;

export interface SegmentedOption {
	id: string;
	label: ReactNode;
}

export interface SegmentedProps {
	className?: string;
	/** Segment ids that exceed the payload's available range — greyed out,
	 * non-interactive (spec §3 "超出 payload 置灰"). */
	disabledIds?: string[];
	onChange: (id: string) => void;
	options: SegmentedOption[];
	value: string;
}

function segmentButtonClass(isSelected: boolean, isDisabled: boolean): string {
	return cn(
		"relative z-0 flex items-center justify-center rounded-md px-3 font-medium text-sm transition-colors",
		MIN_TOUCH_CLASS,
		isDisabled
			? "cursor-not-allowed text-muted-foreground/40"
			: "text-muted-foreground active:scale-[0.98]",
		isSelected && !isDisabled && "text-foreground"
	);
}

/** The sliding pill behind the selected segment's label — a shared
 * `layoutId` lets `motion` animate it between segments instead of each
 * segment owning its own static background. */
function SegmentIndicator({
	instanceId,
	reduced,
}: {
	instanceId: string;
	reduced: boolean;
}) {
	return (
		<motion.span
			className="absolute inset-0 rounded-md bg-background shadow-sm"
			initial={false}
			layoutId={`${instanceId}-segmented-indicator`}
			transition={reduced ? { duration: 0 } : SPRING_POP}
		/>
	);
}

function SegmentLabel({
	children,
	pop,
	reduced,
}: {
	children: ReactNode;
	pop: boolean;
	reduced: boolean;
}) {
	return (
		<motion.span
			animate={pop && !reduced ? { scale: [1, POP_SCALE, 1] } : undefined}
			className="relative z-10"
			transition={reduced ? { duration: 0 } : POP_TRANSITION}
		>
			{children}
		</motion.span>
	);
}

function SegmentButton({
	instanceId,
	option,
	isSelected,
	isDisabled,
	onChange,
	reduced,
}: {
	instanceId: string;
	option: SegmentedOption;
	isSelected: boolean;
	isDisabled: boolean;
	onChange: (id: string) => void;
	reduced: boolean;
}) {
	const active = isSelected && !isDisabled;
	return (
		<button
			aria-pressed={isSelected}
			className={segmentButtonClass(isSelected, isDisabled)}
			disabled={isDisabled}
			onClick={() => onChange(option.id)}
			type="button"
		>
			{active ? (
				<SegmentIndicator instanceId={instanceId} reduced={reduced} />
			) : null}
			<SegmentLabel pop={active} reduced={reduced}>
				{option.label}
			</SegmentLabel>
		</button>
	);
}

/** The primary segmented control (Period or Pivot) — left slot of the
 * `ControlStrip`. Selected segment gets a sliding pill indicator (shared
 * `layoutId`) plus a spring "pop"; disabled ids render greyed, inert.
 * Reduced-motion drops the indicator slide and the pop, snapping instantly. */
export function Segmented({
	className,
	disabledIds,
	onChange,
	options,
	value,
}: SegmentedProps) {
	const reduced = useReducedMotion() ?? false;
	const instanceId = useId();

	return (
		<div
			className={cn(
				"inline-flex items-center gap-0.5 rounded-md bg-muted/40 p-0.5",
				className
			)}
		>
			{options.map((option) => (
				<SegmentButton
					instanceId={instanceId}
					isDisabled={(disabledIds ?? []).includes(option.id)}
					isSelected={value === option.id}
					key={option.id}
					onChange={onChange}
					option={option}
					reduced={reduced}
				/>
			))}
		</div>
	);
}
