import { Collapsible } from "@base-ui/react/collapsible";
import { cn } from "@better-agent/ui/lib/utils";
import { BrainIcon, ChevronDownIcon } from "lucide-react";
import type { ReactNode } from "react";
import { useState } from "react";

/** How much of the streaming text's TAIL gets rendered into the ticker. Only
 * the bottom ~2 wrapped lines are ever visible, so rendering more than this is
 * pure wasted layout work — capping it keeps per-token reflow cost CONSTANT
 * no matter how long the reasoning grows (the performance requirement). 400
 * chars comfortably overfills two lines at any reasonable width, including
 * narrow mobile. */
const TAIL_RENDER_CHARS = 400;

function renderTail(text: string): string {
	return text.length > TAIL_RENDER_CHARS
		? text.slice(-TAIL_RENDER_CHARS)
		: text;
}

/** The first line, for the "done streaming" collapsed preview — a stable
 * snippet rather than a moving window once there's nothing left to stream. */
function firstLinePreview(text: string): string {
	const [firstLine = ""] = text.trim().split("\n", 1);
	return firstLine;
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

/** The collapsed STREAMING preview: a fixed-height, bottom-anchored window
 * over naturally-wrapping text — the teleprompter effect the product asks
 * for. Characters stream into the current line; when the line fills the
 * available WIDTH it wraps (plain CSS line-wrapping — no boundary
 * heuristics), which pushes earlier lines up and out through the top-edge
 * fade. All of that is native layout: the bottom of the text block is pinned
 * to the bottom of the window (flex justify-end) and the overflow clips
 * upward — zero JS measurement, zero animation loop, one text-content update
 * per token. `renderTail` caps how much text participates in layout so the
 * per-token reflow cost stays constant on long reasoning. */
function ReasoningTicker({ text }: { text: string }) {
	const tail = renderTail(text);
	if (tail.trim() === "") {
		return null;
	}
	return (
		<div
			className="reasoning-ticker mt-1 flex flex-col justify-end overflow-hidden"
			data-testid="reasoning-ticker"
		>
			<p className="whitespace-pre-wrap break-words text-muted-foreground text-xs leading-5">
				{tail}
			</p>
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
