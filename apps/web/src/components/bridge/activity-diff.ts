// R1-T3: inline-diff support for a completed fileEdit ActivityItem. Two
// sources, tried in order (see `diffFor`):
//  1. a unified-diff STRING the tool result itself carries (some agents'
//     edit tools echo one back) — `diffFromResult`;
//  2. claude's Edit tool args `{old_string, new_string}` (or the camelCase
//     spelling some adapters normalize to), parsed into a minimal 2-hunk
//     diff (all of `old_string` removed, all of `new_string` added) —
//     `diffFromEditArgs`.
// Neither ToolEvent nor ToolInvocation carries a typed `diff` field (no
// adapter emits one over the wire yet), so source 1 only ever fires for a
// tool result shaped like a raw unified-diff string — kept for forward
// compatibility rather than dead code.

export interface DiffLine {
	sign: "+" | "-";
	text: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function firstString(...values: unknown[]): string | undefined {
	return values.find((value): value is string => typeof value === "string");
}

/** Splits a hunk's text into per-line diff entries, skipping the split
 * entirely for an empty string (a pure insertion has no `old_string`; a
 * pure deletion has no `new_string`) so no spurious blank line appears. */
function hunkLines(
	sign: DiffLine["sign"],
	text: string | undefined
): DiffLine[] {
	if (!text) {
		return [];
	}
	return text.split("\n").map((line) => ({ sign, text: line }));
}

/** Claude's Edit tool call args → a minimal 2-hunk diff: every line of
 * `old_string` removed, every line of `new_string` added. Returns `null`
 * when the args carry neither field (not an Edit-shaped call). */
export function diffFromEditArgs(args: unknown): DiffLine[] | null {
	if (!isRecord(args)) {
		return null;
	}
	const oldText = firstString(args.old_string, args.oldString);
	const newText = firstString(args.new_string, args.newString);
	if (oldText === undefined && newText === undefined) {
		return null;
	}
	return [...hunkLines("-", oldText), ...hunkLines("+", newText)];
}

const DIFF_HEADER_RE = /^(---|\+\+\+|@@|diff --git|index )/;

/** Parses a unified-diff-shaped string into just its +/- lines (context
 * lines and headers dropped — the inline view only ever shows changes). */
function parseUnifiedDiff(text: string): DiffLine[] {
	const lines: DiffLine[] = [];
	for (const line of text.split("\n")) {
		if (DIFF_HEADER_RE.test(line)) {
			continue;
		}
		if (line.startsWith("+")) {
			lines.push({ sign: "+", text: line.slice(1) });
		} else if (line.startsWith("-")) {
			lines.push({ sign: "-", text: line.slice(1) });
		}
	}
	return lines;
}

/** A tool result carrying its own diff: either a `{ diff: string }` wrapper
 * or a bare unified-diff string. Anything else → `null`. */
export function diffFromResult(result: unknown): DiffLine[] | null {
	if (typeof result === "string") {
		return result.includes("@@") || result.includes("+++")
			? parseUnifiedDiff(result)
			: null;
	}
	if (isRecord(result) && typeof result.diff === "string") {
		return parseUnifiedDiff(result.diff);
	}
	return null;
}

/** The diff for one tool call, preferring a wire-supplied diff over parsing
 * Edit-tool args — `null` when neither source yields one. */
export function diffFor(tool: {
	args: unknown;
	result?: unknown;
}): DiffLine[] | null {
	return diffFromResult(tool.result) ?? diffFromEditArgs(tool.args);
}

export function diffCounts(lines: DiffLine[]): {
	added: number;
	removed: number;
} {
	let added = 0;
	let removed = 0;
	for (const line of lines) {
		if (line.sign === "+") {
			added++;
		} else {
			removed++;
		}
	}
	return { added, removed };
}
