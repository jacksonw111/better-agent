import { cn } from "@better-agent/ui/lib/utils";

// P4-T4: the Git pane's unified-diff renderer. Unlike activity-diff.ts (which
// deliberately drops context lines for the inline tool-card diff), a git
// panel's diff keeps EVERYTHING: context lines plain, +/- lines tinted, and
// headers (`diff --git`, `@@`, `---`/`+++`, the CLI's `=== 已暂存 ===`-style
// section markers) muted — so hunks stay readable in place. Borderless, per
// the tool-rendering language: tint + rounding only.

export type DiffLineKind = "add" | "ctx" | "del" | "meta";

/** Rendered-line cap — a 512KB whole-tree diff could otherwise mount tens of
 * thousands of DOM rows; the cut is marked with a trailing meta line. */
export const MAX_RENDER_LINES = 2000;

const META_PREFIXES = ["diff --git", "index ", "@@", "===", "\\ No newline"];

const TRAILING_NEWLINE_RE = /\n$/;

/** Classifies one raw diff line. `---`/`+++` file headers are meta, NOT
 * del/add — checked before the single-char prefixes. */
export function classifyDiffLine(line: string): DiffLineKind {
	if (
		line.startsWith("---") ||
		line.startsWith("+++") ||
		META_PREFIXES.some((prefix) => line.startsWith(prefix))
	) {
		return "meta";
	}
	if (line.startsWith("+")) {
		return "add";
	}
	if (line.startsWith("-")) {
		return "del";
	}
	return "ctx";
}

const LINE_CLASSES: Record<DiffLineKind, string> = {
	add: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
	ctx: "text-foreground/80",
	del: "bg-destructive/10 text-destructive",
	meta: "text-muted-foreground",
};

/** Raw unified-diff text → tinted rows. The empty state ("no diff") is the
 * caller's job — this renders whatever text it's given. */
export function GitDiffView({ text }: { text: string }) {
	const allLines = text.replace(TRAILING_NEWLINE_RE, "").split("\n");
	const lines = allLines.slice(0, MAX_RENDER_LINES);
	const cut = allLines.length > lines.length;
	return (
		<div className="min-h-0 flex-1 overflow-auto rounded-md bg-muted/20 font-mono text-xs leading-relaxed">
			{lines.map((line, index) => (
				<div
					className={cn(
						"whitespace-pre-wrap break-words px-2",
						LINE_CLASSES[classifyDiffLine(line)]
					)}
					// biome-ignore lint/suspicious/noArrayIndexKey: a fixed snapshot for one loaded diff, never reordered
					key={`${index}-${line.slice(0, 8)}`}
				>
					{line === "" ? " " : line}
				</div>
			))}
			{cut ? (
				<div className="px-2 text-muted-foreground italic">
					…（其余 {allLines.length - lines.length} 行已省略）
				</div>
			) : null}
		</div>
	);
}
