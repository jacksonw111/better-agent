import type { ToolCategory } from "./activity-item-header";
import { isMcpToolName } from "./mcp-tool-card";

// fix-tool-render-gaps: `categoryOf` no longer classifies by loose substring
// alone — that misfiled Claude Code's fixed-name tools (TodoWrite→"write",
// WebSearch→"search", ReportFindings→"find", CronCreate→"create", every
// `mcp__*__create_*`/`search_*`/`read_*` call…). Classification is a precise
// pipeline: an `mcp__` call short-circuits to its own card; a known built-in
// maps by EXACT name; only a truly unknown name (codex/opencode's dynamic tool
// names) falls back to the substring heuristics. Split into its own file so
// bridge-tool-card.tsx stays under the repo's 300-line budget.

const COMMAND_RE = /bash|shell|\bsh\b|zsh|exec|command|\brun\b|terminal/;
const FILE_EDIT_RE = /edit|write|create|patch|replace/;
const FILE_READ_RE = /read|view|\bcat\b|open/;
const SEARCH_RE = /grep|glob|search|find|ripgrep/;

/** Claude Code's fixed built-in tools → their terminal-card category. `null`
 * marks a built-in that has NO terminal card (a dedicated card renders it, it
 * folds into its own turn upstream, or the generic fallback is fine) — listed
 * explicitly so the substring heuristics below never misclassify it. */
const BUILTIN_CATEGORY = new Map<string, ToolCategory | null>([
	["Bash", "command"],
	["BashOutput", "command"],
	["KillShell", "command"],
	["KillBash", "command"],
	["SlashCommand", "command"],
	["Read", "fileRead"],
	["Edit", "fileEdit"],
	["Write", "fileEdit"],
	["NotebookEdit", "fileEdit"],
	["Glob", "search"],
	["Grep", "search"],
	// Dedicated cards (routed ahead of the category entry in the registry):
	["TodoWrite", null],
	["WebFetch", null],
	["WebSearch", null],
	["ReportFindings", null],
	// Folded into their own turns upstream (bridge-turns.ts):
	["Task", null],
	["TaskCreate", null],
	["TaskUpdate", null],
	["TaskList", null],
	["TaskGet", null],
	["TaskOutput", null],
	["TaskStop", null],
	["ExitPlanMode", null],
	["EnterPlanMode", null],
	["AskUserQuestion", null],
	// Generic fallback is acceptable — but named here so "create"/"read"/etc.
	// in the substring heuristics can't draw the wrong card:
	["Artifact", null],
	["Monitor", null],
	["REPL", null],
	["Workflow", null],
	["CronCreate", null],
	["CronDelete", null],
	["CronList", null],
	["ScheduleWakeup", null],
	["RemoteTrigger", null],
	["EnterWorktree", null],
	["ExitWorktree", null],
	["ClaudeDesign", null],
	["Projects", null],
	["PushNotification", null],
	["Mcp", null],
	["ListMcpResources", null],
	["ReadMcpResource", null],
	["ReadMcpResourceDir", null],
	["ShowOnboardingRolePicker", null],
]);

/** Substring heuristics for a tool name we don't recognize as a Claude Code
 * built-in — kept ONLY for other CLIs' dynamic tool names (codex's `shell`,
 * opencode's lowercase `edit`/`read`/`grep`). Built-ins never reach here. */
function heuristicCategory(name: string): ToolCategory | null {
	const n = name.toLowerCase();
	if (COMMAND_RE.test(n)) {
		return "command";
	}
	if (FILE_EDIT_RE.test(n)) {
		return "fileEdit";
	}
	if (FILE_READ_RE.test(n)) {
		return "fileRead";
	}
	if (SEARCH_RE.test(n)) {
		return "search";
	}
	return null;
}

export function categoryOf(name: string): ToolCategory | null {
	if (isMcpToolName(name)) {
		return null;
	}
	if (BUILTIN_CATEGORY.has(name)) {
		return BUILTIN_CATEGORY.get(name) ?? null;
	}
	return heuristicCategory(name);
}
