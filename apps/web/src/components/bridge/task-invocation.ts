// The subagent Task's data model + result-text normalization, split out of
// task-card.tsx (the view) for the repo's 300-line cap. The fold layer
// (bridge-turns-tool-task.ts) builds and mutates these; TaskCard renders them.

const TASK_RESULT_PATTERN = /<task_result>([\s\S]*?)<\/task_result>/;
const TASK_WRAPPER_PATTERN = /^<task\b[^>]*>([\s\S]*)<\/task>\s*$/;

/** Strip the `<task id="..." state="...">…</task>` XML wrapper opencode
 * emits around a subagent's summary, keeping only the human-readable text.
 * Prefers the inner `<task_result>` body when present; falls back to the
 * whole wrapped body, then to the raw text unchanged — Claude's built-in
 * Task tool never wraps its result at all. */
export function stripTaskWrapper(text: string): string {
	const resultMatch = TASK_RESULT_PATTERN.exec(text);
	if (resultMatch) {
		return resultMatch[1].trim();
	}
	const wrapperMatch = TASK_WRAPPER_PATTERN.exec(text.trim());
	if (wrapperMatch) {
		return wrapperMatch[1].trim();
	}
	return text.trim();
}

/** One nested tool execution attributed to a running subagent — see
 * `recordSubagentActivity` (bridge-turns-tool-task.ts) for how (and how
 * heuristically) these are accumulated. */
export interface TaskToolRun {
	callId: string;
	name: string;
	status: "running" | "complete" | "error";
}

export interface TaskInvocation {
	callId: string;
	/** Wall-clock ms for the whole subagent run, when the adapter measured it. */
	durationMs?: number;
	/** The task's `prompt` input (claude/opencode), captured at `started`. */
	prompt?: string;
	resultText: string;
	status: "running" | "complete" | "error";
	/** The task's `subagent_type` input, when the agent named one. */
	subagentType?: string;
	title: string;
	/** Optional so hand-built invocations (tests, older fixtures) stay valid;
	 * the fold layer always creates it. */
	toolRuns?: TaskToolRun[];
}
