import { Collapsible } from "@base-ui/react/collapsible";
import { cn } from "@better-agent/ui/lib/utils";
import { BrainIcon, ChevronDownIcon } from "lucide-react";
import type { ReactNode } from "react";
import { useState } from "react";

// How many sentences the collapsed streaming window shows at once: the newest
// (possibly still-forming) sentence plus the one before it for context.
const PREVIEW_LINE_COUNT = 2;

/** Sentence/line boundaries for the vertical ticker: hard newlines, plus CJK
 * and latin sentence enders (kept attached to their sentence via lookbehind). */
const SEGMENT_SPLIT = /\n+|(?<=[。？！；!?;.])\s*/;

/** The reasoning text as trimmed, non-empty sentence segments — the units the
 * collapsed preview scrolls by (one SENTENCE at a time, vertically), per the
 * product requirement: 一句话一句话上下滚动, not a per-character tail. */
function reasoningSegments(text: string): string[] {
	return text
		.split(SEGMENT_SPLIT)
		.map((segment) => segment.trim())
		.filter((segment) => segment !== "");
}

/** The first sentence, for the "done streaming" collapsed preview — a stable
 * snippet rather than a moving window once there's nothing left to stream. */
function firstLinePreview(text: string): string {
	return reasoningSegments(text)[0] ?? "";
}

export function Reasoning({
	isStreaming,
	text,
	children,
	className,
}: {
	isStreaming: boolean;
	/** Raw reasoning text, used only to derive the collapsed-state preview;
	 * `children` still renders the full (formatted) content when expanded. */
	text: string;
	children: ReactNode;
	className?: string;
}) {
	// Always starts (and stays, unless the user clicks) collapsed — streaming
	// no longer auto-expands this. Because open state is driven solely by the
	// user's own click, "user intent wins" falls out for free: nothing else
	// ever calls setOpen.
	const [open, setOpen] = useState(false);
	return (
		<Collapsible.Root
			className={cn("rounded-md border bg-muted/40 p-2", className)}
			onOpenChange={setOpen}
			open={open}
		>
			{children}
			{!open && isStreaming ? <ReasoningTicker text={text} /> : null}
			{open || isStreaming ? null : (
				<ReasoningSnippet text={firstLinePreview(text)} />
			)}
		</Collapsible.Root>
	);
}

/** The collapsed STREAMING preview: a fixed two-line window over the newest
 * sentences. Each completed sentence keeps its absolute index as its React
 * key, so when a new sentence lands the older one keeps its DOM node and
 * shifts up in flow while the new line animates in from below
 * (`.reasoning-ticker-line`, one-shot CSS entry, disabled under
 * prefers-reduced-motion) — the "sentence-by-sentence scrolls upward" effect,
 * with no JS animation loop. The still-forming tail sentence updates its text
 * in place without re-animating. */
function ReasoningTicker({ text }: { text: string }) {
	const segments = reasoningSegments(text);
	if (segments.length === 0) {
		return null;
	}
	const visible = segments.slice(-PREVIEW_LINE_COUNT);
	const baseIndex = segments.length - visible.length;
	return (
		<div
			className="reasoning-ticker mt-1 flex flex-col justify-end overflow-hidden"
			data-testid="reasoning-ticker"
		>
			{visible.map((line, i) => (
				<p
					className="reasoning-ticker-line truncate text-muted-foreground text-xs leading-5"
					// biome-ignore lint/suspicious/noArrayIndexKey: keyed by the segment's ABSOLUTE index — segments are append-only and never reorder, so this is the stable identity that keeps an existing sentence's DOM node while a new one animates in.
					key={baseIndex + i}
				>
					{line}
				</p>
			))}
		</div>
	);
}

/** The collapsed DONE preview: the first sentence, stable, single line. */
function ReasoningSnippet({ text }: { text: string }) {
	if (!text) {
		return null;
	}
	return (
		<p className="mt-1 truncate text-muted-foreground text-xs leading-5">
			{text}
		</p>
	);
}

export function ReasoningTrigger({ label }: { label: string }) {
	return (
		<Collapsible.Trigger className="flex w-full items-center gap-1.5 text-muted-foreground text-xs hover:text-foreground">
			<BrainIcon className="size-3.5" />
			<span>{label}</span>
			<ChevronDownIcon className="ml-auto size-3.5 transition-transform data-[panel-open]:rotate-180" />
		</Collapsible.Trigger>
	);
}

export function ReasoningContent({ children }: { children: ReactNode }) {
	return (
		<Collapsible.Panel className="mt-2 text-muted-foreground text-xs leading-relaxed">
			{children}
		</Collapsible.Panel>
	);
}
