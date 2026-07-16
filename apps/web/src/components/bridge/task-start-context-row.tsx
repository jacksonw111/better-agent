import { ChevronRightIcon } from "lucide-react";
import { useState } from "react";

// S3-T2 (master spec §10.2/§11): the CLI injects the Task Start Context as
// the run's first user input, origin-tagged so the web can tell it apart from
// something the user actually typed. It renders collapsed by default — one
// quiet line on the user side of the feed — because the resolved context
// (expanded skills, workspace path, environment facts) is agent-facing detail
// the user already saw as the Opening Message; it stays one click away
// instead of dominating the conversation.

/** The collapsed, expandable rendering of an `origin: "task-start"` user
 * turn. Zero-border discipline (tint + rounding only), aligned to the user
 * side like the bubble it replaces. */
export function TaskStartContextRow({ text }: { text: string }) {
	const [expanded, setExpanded] = useState(false);
	return (
		<div className="flex flex-col items-end gap-1">
			<button
				aria-expanded={expanded}
				className="flex items-center gap-1 rounded-md px-2 py-1 text-muted-foreground text-xs transition-colors hover:bg-muted/60 hover:text-foreground"
				onClick={() => setExpanded((open) => !open)}
				type="button"
			>
				<ChevronRightIcon
					aria-hidden
					className={`size-3.5 transition-transform ${expanded ? "rotate-90" : ""}`}
				/>
				Task start context sent to agent
			</button>
			{expanded && (
				<div className="max-w-full overflow-x-auto rounded-lg bg-muted/40 p-3">
					<pre className="whitespace-pre-wrap font-mono text-muted-foreground text-xs leading-relaxed">
						{text}
					</pre>
				</div>
			)}
		</div>
	);
}
