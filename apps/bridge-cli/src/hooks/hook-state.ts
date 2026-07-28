// Observability slice B: map a Claude Code hook event name to the coarse
// session `activity_state` the dashboard shows. Pure + version-tolerant — an
// unrecognized event returns undefined (no STATE frame emitted), so a future
// claude release that adds events can't corrupt state.
//
// The mapping is the real-machine spike's tested conclusions —
// see docs/research/2026-07-28-claude-hooks-observability-spike.md §状态机:
//   SessionStart                                   → starting
//   UserPromptSubmit / PreToolUse / PostToolUse    → working
//   Stop                                           → idle   (turn complete)
//   SessionEnd                                     → ended
//   Notification                                   → idle   (conservative; the
//     spike could not confirm its subtypes under bypassPermissions, so we do
//     NOT branch on any unverified Notification field — just report idle)
//   SubagentStop                                   → working (a subagent
//     finished but the PARENT turn is still running; inferred, not spike-tested,
//     and harmless — it refreshes activity while the parent continues)

/** The coarse session activity states the dashboard renders. */
export type ActivityState = "starting" | "working" | "idle" | "ended";

const EVENT_TO_STATE: Record<string, ActivityState> = {
	SessionStart: "starting",
	UserPromptSubmit: "working",
	PreToolUse: "working",
	PostToolUse: "working",
	SubagentStop: "working",
	Stop: "idle",
	Notification: "idle",
	SessionEnd: "ended",
};

/** The activity_state a hook event maps to, or undefined for an unknown event
 * (which must NOT emit a STATE frame — version tolerance). */
export function mapHookEventToState(event: string): ActivityState | undefined {
	return EVENT_TO_STATE[event];
}
