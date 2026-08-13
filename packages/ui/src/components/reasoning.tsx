import { Collapsible } from "@base-ui/react/collapsible";
import { cn } from "@better-agent/ui/lib/utils";
import { ChevronDownIcon } from "lucide-react";
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

/** Left rail indent (beautifului.dev thinking-state): content hangs off a
 * hairline vertical rule aligned under the header's sparkle icon. */
const RAIL_CLASSES = "mt-1 ml-2 border-border border-l pl-4";

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
			className={cn("flex w-full flex-col", className)}
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
			className={cn(
				"reasoning-ticker flex flex-col justify-end overflow-hidden",
				RAIL_CLASSES
			)}
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
		<p
			className={cn(
				"truncate text-muted-foreground text-xs leading-5",
				RAIL_CLASSES
			)}
		>
			{text}
		</p>
	);
}

/** Four-point sparkle (beautifului.dev thinking-state header icon). */
function SparkleIcon({ className }: { className?: string }) {
	return (
		<svg
			aria-hidden="true"
			className={className}
			fill="currentColor"
			height="16"
			viewBox="0 0 24 24"
			width="16"
		>
			<path d="M12 2l2.4 7.2L22 12l-7.6 2.8L12 22l-2.4-7.2L2 12l7.6-2.8z" />
		</svg>
	);
}

export function ReasoningTrigger({
	label,
	isStreaming = false,
}: {
	label: string;
	/** Shimmers the label while the reasoning is still streaming in. */
	isStreaming?: boolean;
}) {
	return (
		<Collapsible.Trigger className="group -mx-1.5 flex w-fit items-center gap-2 rounded-lg px-1.5 py-1 transition-colors duration-100 hover:bg-accent">
			<SparkleIcon
				className={cn(
					"shrink-0",
					isStreaming ? "text-muted-foreground" : "text-muted-foreground/70"
				)}
			/>
			<span
				className={cn(
					"whitespace-nowrap font-medium text-sm",
					isStreaming ? "bui-shimmer" : "text-muted-foreground"
				)}
			>
				{label}
			</span>
			<ChevronDownIcon className="size-3.5 shrink-0 text-muted-foreground transition-transform duration-300 group-data-[panel-open]:rotate-180" />
		</Collapsible.Trigger>
	);
}

export function ReasoningContent({ children }: { children: ReactNode }) {
	return (
		<Collapsible.Panel
			className={cn(
				"py-1 text-muted-foreground text-xs leading-relaxed",
				RAIL_CLASSES
			)}
		>
			{children}
		</Collapsible.Panel>
	);
}
