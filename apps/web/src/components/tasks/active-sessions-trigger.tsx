import { PopoverTrigger } from "@better-agent/ui/components/popover";
import { cn } from "@better-agent/ui/lib/utils";
import { RadioTowerIcon } from "lucide-react";

// The indicator's button, in the two shapes its two mounts need: a compact
// pill for the sidebar footer, and a full dock tab (stacked icon + label,
// count as a corner badge) for the <md floating dock. Both render the same
// three `data-state`s so the "is anything running / does anything want me"
// signal reads identically wherever the user happens to be looking.

export type IndicatorState = "attention" | "idle" | "running";
export type IndicatorVariant = "bar" | "dock";

const BAR_STATE_CLASS: Record<IndicatorState, string> = {
	attention: "text-amber-600 hover:bg-amber-500/10 dark:text-amber-400",
	idle: "text-muted-foreground hover:bg-muted/60",
	running: "text-foreground hover:bg-muted/60",
};

const DOCK_STATE_CLASS: Record<IndicatorState, string> = {
	attention: "text-amber-600 dark:text-amber-400",
	idle: "text-muted-foreground",
	running: "text-foreground",
};

const COUNT_STATE_CLASS: Record<IndicatorState, string> = {
	attention: "bg-amber-500 text-white",
	idle: "",
	running: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
};

export function triggerLabel(total: number, attentionCount: number): string {
	if (total === 0) {
		return "No active sessions";
	}
	const base = `${total} active session${total === 1 ? "" : "s"}`;
	return attentionCount > 0
		? `${base}, ${attentionCount} waiting for you`
		: base;
}

export function indicatorState(
	total: number,
	attention: boolean
): IndicatorState {
	if (attention) {
		return "attention";
	}
	return total > 0 ? "running" : "idle";
}

/** The count pill — absent at zero (the icon alone carries the quiet state). */
function CountBadge({
	className,
	state,
	total,
}: {
	className?: string;
	state: IndicatorState;
	total: number;
}) {
	if (total === 0) {
		return null;
	}
	return (
		<span
			className={cn(
				"min-w-4 rounded-full px-1 text-center font-medium text-[11px] leading-4",
				COUNT_STATE_CLASS[state],
				className
			)}
			data-testid="active-sessions-count"
		>
			{total}
		</span>
	);
}

/** The <md dock tab: stacked icon + "Active" label, matching the sibling tab
 * links, with the count riding the icon's top-right corner. */
function DockTrigger({
	state,
	total,
}: {
	state: IndicatorState;
	total: number;
}) {
	return (
		<>
			<span className="relative">
				<RadioTowerIcon
					className={cn("size-5", state === "attention" && "animate-pulse")}
				/>
				<CountBadge
					className="absolute -top-1 -right-2"
					state={state}
					total={total}
				/>
			</span>
			Active
		</>
	);
}

/** Sidebar-footer shape: icon + inline count, sized like its ThemeToggle and
 * UserMenu neighbours. */
function BarTrigger({
	state,
	total,
}: {
	state: IndicatorState;
	total: number;
}) {
	return (
		<>
			<RadioTowerIcon
				className={cn("size-4", state === "attention" && "animate-pulse")}
			/>
			<CountBadge state={state} total={total} />
		</>
	);
}

export function ActiveSessionsTrigger({
	attentionCount,
	state,
	total,
	variant,
}: {
	attentionCount: number;
	state: IndicatorState;
	total: number;
	variant: IndicatorVariant;
}) {
	const dock = variant === "dock";
	// Shape and colour resolved before the class merge — keeping the lookups off
	// the `cn(...)` lines also keeps the repo's Tailwind arbitrary-value check
	// from reading `CLASS[state]` as a `[…]` arbitrary value.
	const shapeClass = dock
		? "flex-1 flex-col justify-center gap-0.5 py-1.5 text-xs"
		: "gap-1.5 rounded-lg px-2 py-1.5";
	const stateClass = dock ? DOCK_STATE_CLASS[state] : BAR_STATE_CLASS[state];
	return (
		<PopoverTrigger
			aria-label={triggerLabel(total, attentionCount)}
			className={cn(
				"flex items-center transition-colors",
				shapeClass,
				stateClass
			)}
			data-state={state}
			data-testid="active-sessions-trigger"
			type="button"
		>
			{dock ? (
				<DockTrigger state={state} total={total} />
			) : (
				<BarTrigger state={state} total={total} />
			)}
		</PopoverTrigger>
	);
}
