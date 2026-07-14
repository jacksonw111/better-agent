import type { ToolInvocation } from "@better-agent/ui/components/chat/chat-blocks";
import { cn } from "@better-agent/ui/lib/utils";
import { CheckIcon, CopyIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useClientPref } from "@/utils/preferences";
import {
	commandText,
	HeaderChevron,
	HeaderDuration,
	StatusIcon,
} from "./activity-item-header";
import {
	computeErrorLine,
	computeOutput,
	computeRawParams,
	computeTail,
	ErrorPreviewLine,
	RawParamsSection,
	TailLine,
} from "./tool-output-preview";

// P1-T3: the dedicated card for a shell/command tool call — `$`-prefixed
// command line, live preview tail + spinner while running, duration when
// settled, and the captured output inline in the card (expandable only once
// there IS output, with a line count and a copy button). Modeled on
// claudecodeui's BashCommandDisplay, rendered in our borderless language.

const COPY_RESET_MS = 2000;

/**
 * Disclosure state with a "late output auto-expands ONCE" contract: a failed
 * command's output usually lands only after completion, so `defaultOpen =
 * isError` alone (state initialized at mount) would never open it. Instead
 * the error auto-open is applied the first time it becomes applicable — and
 * ONLY that once (`autoApplied` ref): any manual toggle also consumes the
 * slot, so a user who collapsed the card is never popped open again by a
 * later re-render. Shared with `TaskCard` (task-card.tsx), whose failure
 * status arrives just as late.
 */
export function useAutoOpenOnError(shouldAutoOpen: boolean): {
	open: boolean;
	setOpenManually: (next: boolean) => void;
} {
	const [open, setOpen] = useState(false);
	const autoApplied = useRef(false);
	useEffect(() => {
		if (shouldAutoOpen && !autoApplied.current) {
			autoApplied.current = true;
			setOpen(true);
		}
	}, [shouldAutoOpen]);
	const setOpenManually = useCallback((next: boolean) => {
		autoApplied.current = true;
		setOpen(next);
	}, []);
	return { open, setOpenManually };
}

function CopyOutputButton({ text }: { text: string }) {
	const [copied, setCopied] = useState(false);
	const onCopy = () => {
		navigator.clipboard.writeText(text).then(
			() => {
				setCopied(true);
				setTimeout(() => setCopied(false), COPY_RESET_MS);
			},
			() => {
				// clipboard blocked (non-secure context / no permission): no-op
			}
		);
	};
	return (
		<button
			aria-label="Copy output"
			className="flex items-center gap-1 rounded px-1.5 py-0.5 text-muted-foreground transition-colors hover:text-foreground"
			onClick={onCopy}
			type="button"
		>
			{copied ? (
				<CheckIcon className="size-3 text-emerald-500" />
			) : (
				<CopyIcon className="size-3" />
			)}
			{copied ? "Copied" : "Copy"}
		</button>
	);
}

function lineCountLabel(output: string): string {
	const count = output.split("\n").length;
	return count === 1 ? "1 line" : `${count} lines`;
}

/** The expanded output: a small meta row (line count + copy) over the
 * scrollable capped output — rendered only once the panel is open AND the
 * command actually produced output. */
function OutputPanel({ open, output }: { open: boolean; output: string }) {
	if (!(open && output)) {
		return null;
	}
	return (
		<div className="flex flex-col gap-1 px-2 pb-2">
			<div className="flex items-center justify-between text-muted-foreground text-xs">
				<span className="tabular-nums">{lineCountLabel(output)}</span>
				<CopyOutputButton text={output} />
			</div>
			<pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-md bg-background/60 px-2 py-1.5 font-mono text-muted-foreground text-xs leading-relaxed">
				{output}
			</pre>
		</div>
	);
}

function CommandHeader({
	hasBody,
	onToggle,
	open,
	tool,
}: {
	hasBody: boolean;
	onToggle: () => void;
	open: boolean;
	tool: ToolInvocation;
}) {
	return (
		<button
			aria-expanded={hasBody ? open : undefined}
			className="flex w-full items-center gap-2 px-2 py-1.5 text-left"
			disabled={!hasBody}
			onClick={onToggle}
			type="button"
		>
			<span
				aria-hidden
				className="shrink-0 select-none font-mono font-semibold text-emerald-500"
			>
				$
			</span>
			<span className="flex-1 truncate font-mono text-foreground">
				{commandText(tool.args) || tool.title || (
					<span className="text-muted-foreground">{tool.toolName}</span>
				)}
			</span>
			<HeaderDuration durationMs={tool.durationMs} />
			<StatusIcon tool={tool} />
			<HeaderChevron hasBody={hasBody} open={open} />
		</button>
	);
}

/** The command card itself: header (always), live tail (running), persistent
 * one-line error preview (failed + collapsed), inline output (expanded). */
export function BashCommandCard({ tool }: { tool: ToolInvocation }) {
	const output = computeOutput(tool);
	// P2-T4: with the raw-params pref on, the input JSON counts as body too —
	// a command with no captured output still gets a working disclosure.
	const rawParams = computeRawParams(tool, useClientPref("showRawParameters"));
	const hasBody = output.length > 0 || rawParams !== "";
	const { open, setOpenManually } = useAutoOpenOnError(tool.isError && hasBody);
	const tail = computeTail(tool);
	const errorLine = computeErrorLine(tool, hasBody, open);
	return (
		<div
			className={cn(
				"overflow-hidden rounded-md bg-muted/40 text-xs",
				tool.isError && "bg-destructive/10"
			)}
		>
			<CommandHeader
				hasBody={hasBody}
				onToggle={() => setOpenManually(!open)}
				open={open}
				tool={tool}
			/>
			<TailLine tail={tail} />
			<ErrorPreviewLine text={errorLine} />
			<RawParamsSection open={open} text={rawParams} />
			<OutputPanel open={open} output={output} />
		</div>
	);
}
