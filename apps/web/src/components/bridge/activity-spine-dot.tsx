import type { ToolInvocation } from "@better-agent/ui/components/chat/chat-blocks";
import { cn } from "@better-agent/ui/lib/utils";
import type { ReactNode } from "react";

// R1-T3: the 4px status dot each activity item sits on along its turn's
// spine (the `border-l` column in assistant-turn-block.tsx) — semantic tones
// only, per the design system: running=blue-500 (pulsing), ok=emerald-500,
// error=destructive.

export type ActivityTone = "error" | "ok" | "running";

const DOT_TONE_CLASS: Record<ActivityTone, string> = {
	error: "bg-destructive",
	ok: "bg-emerald-500",
	running: "animate-pulse bg-blue-500",
};

export function toneOfTool(tool: ToolInvocation): ActivityTone {
	if (tool.status === "running") {
		return "running";
	}
	if (tool.isError || tool.status === "error") {
		return "error";
	}
	return "ok";
}

/** A collapsed ActivityGroup only ever forms once its whole run has
 * completed (see activity-blocks.ts), so its dot is never `running` —
 * `error` if any call in the run failed, `ok` otherwise. */
export function toneOfGroup(tools: ToolInvocation[]): ActivityTone {
	const hasError = tools.some(
		(tool) => tool.isError || tool.status === "error"
	);
	return hasError ? "error" : "ok";
}

function SpineDot({ tone }: { tone: ActivityTone }) {
	return (
		<span
			aria-hidden
			className={cn(
				"absolute top-2 -left-3 size-1 -translate-x-1/2 rounded-full ring-2 ring-background",
				DOT_TONE_CLASS[tone]
			)}
		/>
	);
}

/** Wraps one activity element (an ActivityItem or an ActivityGroup) with its
 * spine dot, positioned against the parent column's `border-l` (see the
 * `-left-3` note: it exactly cancels the column's `pl-3`, landing the dot on
 * the line itself; `-translate-x-1/2` then centers it on that line). */
export function SpineItem({
	tone,
	children,
}: {
	tone: ActivityTone;
	children: ReactNode;
}) {
	return (
		<div className="relative">
			<SpineDot tone={tone} />
			{children}
		</div>
	);
}
