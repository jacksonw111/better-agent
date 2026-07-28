import { cn } from "@better-agent/ui/lib/utils";

// Observability slice C: a session's coarse activity, rendered from the
// `activity_state` the CLI reports through hooks (working / idle / starting /
// ended). It's the glanceable "is this agent still busy?" signal on the
// dashboard and in the session list — no terminal entry required. The field can
// be null (a session that predates the feature, or one that hasn't reported
// yet); that renders as a neutral placeholder, never an error. No borders —
// tint + radius, matching the rest of the tool/session surfaces.

export type ActivityState = "working" | "idle" | "starting" | "ended";

interface StateMeta {
	/** Chip tint + text (label variant). */
	chip: string;
	/** The dot fill (works in both themes). */
	dot: string;
	/** Human label, also the aria description. */
	label: string;
	/** Whether the dot animates — only a live, working session pulses. */
	pulse: boolean;
}

const STATE_META: Record<ActivityState, StateMeta> = {
	working: {
		label: "Working",
		dot: "bg-emerald-500",
		chip: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
		pulse: true,
	},
	starting: {
		label: "Starting",
		dot: "bg-sky-500",
		chip: "bg-sky-500/10 text-sky-600 dark:text-sky-400",
		pulse: false,
	},
	idle: {
		label: "Idle",
		dot: "bg-muted-foreground/50",
		chip: "bg-muted text-muted-foreground",
		pulse: false,
	},
	ended: {
		label: "Ended",
		dot: "bg-muted-foreground/30",
		chip: "bg-muted/60 text-muted-foreground",
		pulse: false,
	},
};

const UNKNOWN_META: StateMeta = {
	label: "Status unknown",
	dot: "bg-muted-foreground/25",
	chip: "bg-muted/60 text-muted-foreground",
	pulse: false,
};

function metaFor(state: string | null | undefined): StateMeta {
	if (state && state in STATE_META) {
		return STATE_META[state as ActivityState];
	}
	return UNKNOWN_META;
}

/** Just the status dot — a working session pulses, everything else is static.
 * The aria-label carries the state so it's not a purely visual signal. */
export function ActivityDot({
	state,
	className,
}: {
	state: string | null | undefined;
	className?: string;
}) {
	const meta = metaFor(state);
	return (
		<span
			aria-label={meta.label}
			className={cn("relative flex size-2 shrink-0", className)}
			role="img"
		>
			{meta.pulse ? (
				<span
					aria-hidden
					className={cn(
						"absolute inline-flex h-full w-full animate-ping rounded-full opacity-60",
						meta.dot
					)}
				/>
			) : null}
			<span
				aria-hidden
				className={cn("relative inline-flex size-2 rounded-full", meta.dot)}
			/>
		</span>
	);
}

/** Dot + text label chip. Used where there's room for the word (the dashboard's
 * cross-machine session rows); the bare `ActivityDot` is used inline in tight
 * lists. */
export function ActivityStateBadge({
	state,
	className,
}: {
	state: string | null | undefined;
	className?: string;
}) {
	const meta = metaFor(state);
	return (
		<span
			className={cn(
				"inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 font-medium text-xs transition-colors",
				meta.chip,
				className
			)}
		>
			<ActivityDot state={state} />
			{meta.label}
		</span>
	);
}
