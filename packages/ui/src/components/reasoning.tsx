import { Collapsible } from "@base-ui/react/collapsible";
import { cn } from "@better-agent/ui/lib/utils";
import { BrainIcon, ChevronDownIcon } from "lucide-react";
import type { ReactNode } from "react";
import { useState } from "react";

// Collapsed-preview budget: enough characters for a single line at the trigger
// row's text size without measuring layout.
const TAIL_PREVIEW_CHARS = 80;

/** The tail of the text (its most-recently-streamed end), single line,
 * prefixed with an ellipsis when truncated — reads as text ticking forward as
 * it streams in, with no JS animation loop involved. */
function tailPreview(text: string): string {
	const trimmed = text.trim();
	if (trimmed.length <= TAIL_PREVIEW_CHARS) {
		return trimmed;
	}
	return `…${trimmed.slice(-TAIL_PREVIEW_CHARS)}`;
}

/** The first line of the text, for the "done streaming" collapsed preview —
 * a stable snippet rather than a constantly-moving tail once there's nothing
 * left to stream. */
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
	const preview = isStreaming ? tailPreview(text) : firstLinePreview(text);
	return (
		<Collapsible.Root
			className={cn("rounded-md border bg-muted/40 p-2", className)}
			onOpenChange={setOpen}
			open={open}
		>
			{children}
			{!open && preview ? <ReasoningPreview text={preview} /> : null}
		</Collapsible.Root>
	);
}

function ReasoningPreview({ text }: { text: string }) {
	return (
		<p className="reasoning-tail mt-1 overflow-hidden whitespace-nowrap text-right text-muted-foreground text-xs">
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
