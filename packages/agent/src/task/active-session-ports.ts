import type { BridgeSessionStatus } from "../bridge-session-ports";
import type { BridgeAgentKind } from "../bridge-token-ports";
import type { RunStatus } from "./task-ports";

// The multi-session product model: a session is a long-lived unit of work that
// keeps running when the user navigates away, and only `endSession` settles
// it. That makes "which of my sessions are still alive right now?" a
// first-class question — the user has no other way to find work that is still
// going or is blocked waiting on them, across every computer and project.
//
// Answering it per-task through the existing stores would be an N+1 storm
// (latest run per task, then its computer, project and bridge session), and
// the web polls this view every ~10s. So it gets its own read port: ONE joined
// query returning everything the global view needs, including the raw
// liveness inputs (`computerLastSeenAt`, `sessionStatus`) the API's stale-run
// reconcile (routers/tasks-run-status.ts) needs to tell a genuinely live run
// from a dead reporter.

/** The latest Run of one Task plus the joined context the global active-session
 * view renders — one row per active session, no follow-up reads required. */
export interface ActiveSessionRow {
	agentKind: BridgeAgentKind;
	computerId: string;
	/** Heartbeat recency of the Run's computer — a reconcile input, not display
	 * data: a computer silent past the grace window means nobody is left to
	 * report this run's real status. */
	computerLastSeenAt: Date;
	computerName: string;
	projectId: string | null;
	/** Null when the Task has no Project, or the Project row is gone. */
	projectName: string | null;
	runId: string;
	runStatus: RunStatus;
	/** The Run's bound bridge session, null until the client binds one. */
	sessionId: string | null;
	/** Last poll/WS activity of the bound session — the freshest "this session
	 * did something" signal there is. Null when no session is bound (or its row
	 * was hard-deleted, leaving the binding dangling). */
	sessionLastSeenAt: Date | null;
	/** Null when no session is bound OR the bound row no longer exists; both
	 * mean the same thing to the reconcile — nobody is reporting. */
	sessionStatus: BridgeSessionStatus | null;
	taskId: string;
	taskName: string;
	/** Fallback for `lastActivityAt` when no bridge session is bound yet. */
	updatedAt: Date;
}

export interface ActiveSessionStore {
	/**
	 * Every Task of `userId` whose LATEST Run is non-terminal, with its
	 * computer/project/session context joined in. Latest-run-only on purpose:
	 * an old non-terminal row left behind by a retried task is history, not a
	 * live session. Order is unspecified — the caller sorts by activity, which
	 * it can only compute after the reconcile pass.
	 */
	listActiveByUser(userId: string): Promise<ActiveSessionRow[]>;
}
