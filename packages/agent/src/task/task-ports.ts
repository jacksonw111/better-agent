// Task/Run domain port types (S2-T1, master spec §6.7–6.15). A Task is the
// user's persistent unit of work (name + verbatim description + chosen
// Computer/Runtime + immutable Opening Message); a Run is one continuous
// execution of that Task by an Agent Runtime on that Computer. Tasks and Runs
// are separate on purpose: a Task accumulates sequential Runs (retry = new
// Run), and per-Run issue snapshots record what the Agent saw at launch time.

import type { BridgeAgentKind } from "../bridge-token-ports";

/** Task lifecycle. v1 creates Tasks as `active` straight away — `draft` is a
 * reserved model slot for future save-as-draft / offline queueing (§6.7). */
export type TaskStatus = "draft" | "active" | "completed" | "archived";

/** Run lifecycle, reported by the client as launch progresses. `failed`
 * carries the real error in `errorMessage` — never a synthesized one. */
export type RunStatus =
	| "created"
	| "launching"
	| "preparing_workspace"
	| "starting_runtime"
	| "running"
	| "waiting_for_user"
	| "failed"
	| "stopped"
	| "completed";

/** Where a Run works: a git-worktree-backed repository checkout, a clean
 * managed task directory when the Task has no repository (§6.16), or — Q1 —
 * the fixed directory of a Project (a long-lived per-Computer repository
 * checkout shared by every session on that Project). */
export type WorkspaceKind = "repository" | "standalone" | "project";

/** Per-Run snapshot of a linked GitHub issue, captured at launch time so the
 * Run records exactly which requirements the Agent worked from (§6.15). */
export interface IssueSnapshot {
	body: string;
	number: number;
	title: string;
	url: string;
}

export interface TaskInsert {
	agentKind: BridgeAgentKind;
	computerId: string;
	/** The user's instruction, stored verbatim — never rewritten (§6.9). */
	description: string;
	name: string;
	/** Assembled once at creation (§10.1) and immutable thereafter. */
	openingMessage: string;
	/** Q1: the Project this Task's sessions run inside — null/omitted for
	 * repository and stand-alone Tasks. Optional (not `string | null`) so
	 * pre-Q1 callers keep compiling; stores normalize omission to null. */
	projectId?: string | null;
	/** GitHub-resolved clone URL, saved at creation (S4-T2, §6.14) — the
	 * Launch payload's repository intent uses it verbatim, never a guess. */
	repositoryCloneUrl: string | null;
	/** The repository's real default branch at creation time (S4-T2) —
	 * replaces the pre-S4 assumed-"main" fallback. */
	repositoryDefaultBranch: string | null;
	repositoryFullName: string | null;
	repositoryUrl: string | null;
	userId: string;
}

export interface TaskRow extends TaskInsert {
	createdAt: Date;
	id: string;
	projectId: string | null;
	status: TaskStatus;
	updatedAt: Date;
}

export interface RunInsert {
	agentKind: BridgeAgentKind;
	branch: string | null;
	computerId: string;
	/** Pre-generated Run id (S2-T3): tasks.create mints the uuid up front so
	 * `launchKey` can literally equal it (D4). DB default when omitted. */
	id?: string;
	issueSnapshots: IssueSnapshot[];
	/** Idempotency key for Launch delivery — equals the run id (D4). */
	launchKey: string;
	/** P1 (session resume): the previous run's runtime conversation id — the
	 * bound bridge session's `agentSessionId` — captured at tasks.resume so the
	 * Launch payload can tell the client to `--resume` that exact conversation.
	 * Optional: cold starts (create/retry) never set it. */
	resumeAgentSessionId?: string | null;
	/** The pre-issued internal bridge token backing `sessionCredential` in the
	 * Launch payload (S2-T2, design D4). Optional so pre-S2-T2 callers keep
	 * compiling; S2-T3's run creation always sets it. */
	sessionTokenId?: string | null;
	taskId: string;
	workspaceKind: WorkspaceKind;
}

export interface RunRow extends RunInsert {
	createdAt: Date;
	errorMessage: string | null;
	id: string;
	resumeAgentSessionId: string | null;
	/** Relay binding — set once the client attaches the runtime to its
	 * pre-issued bridge session (D4). */
	sessionId: string | null;
	sessionTokenId: string | null;
	status: RunStatus;
	updatedAt: Date;
	/** The client-reported local workspace path, once prepared. */
	workspacePath: string | null;
}

/** Partial status update from the client: only provided fields change.
 * `status` itself is optional so a pure binding update (e.g. startSession
 * setting `sessionId`) never has to guess the Run's current status. */
export interface RunStatusUpdate {
	errorMessage?: string | null;
	sessionId?: string;
	status?: RunStatus;
	workspacePath?: string;
}

/** Workspace intent delivered with a Launch Command (§9.1): everything the
 * client needs to decide how to prepare the Run's working directory. */
export interface RepositoryWorkspaceIntent {
	cloneUrl: string;
	defaultBranch: string;
	fullName: string;
	kind: "repository";
}

export interface StandaloneWorkspaceIntent {
	kind: "standalone";
}

/** Q1: run inside the Project's long-lived checkout. The payload carries the
 * projectId ONLY — the client resolves the absolute path from its own local
 * project record; the server never dictates a filesystem path. */
export interface ProjectWorkspaceIntent {
	kind: "project";
	projectId: string;
}

export type RunWorkspaceIntent =
	| StandaloneWorkspaceIntent
	| RepositoryWorkspaceIntent
	| ProjectWorkspaceIntent;

/** The Launch Command for a Run awaiting launch (§9.1, design D4) — pushed
 * over the computer control WS and returned as heartbeat `pendingCommands`.
 * Delivery is idempotent by construction: only `created` Runs produce one,
 * and the client's ack (runs.ackLaunch) moves the Run past `created`. */
export interface RunLaunchCommand {
	agentKind: BridgeAgentKind;
	/** The user's instruction, verbatim (§6.9). */
	description: string;
	issueSnapshots: IssueSnapshot[];
	kind: "launch";
	/** Canonical GitHub web URL of the Task's repository (S4-T2) — the client
	 * renders it as the start context's `Repository:` line (§10.1); null for
	 * stand-alone Tasks. */
	repositoryUrl: string | null;
	/** P1 (session resume): the previous run's runtime conversation id — the
	 * client passes it to the runtime's native resume (e.g. `--resume`) so the
	 * new Run continues the SAME conversation. Omitted entirely for cold
	 * starts and when the runtime never reported a conversation id. */
	resumeAgentSessionId?: string;
	runId: string;
	/** Raw pre-issued `bt_…` bridge token the client uses to attach the
	 * launched runtime to the existing session relay (D4). */
	sessionCredential: string;
	taskId: string;
	workspace: RunWorkspaceIntent;
}

export interface TaskStore {
	/** Owner-scoped read; null when the row isn't the caller's. */
	getById(id: string, userId: string): Promise<TaskRow | null>;
	insert(input: TaskInsert): Promise<TaskRow>;
	/** Newest first (createdAt desc). */
	listByUser(userId: string): Promise<TaskRow[]>;
	/** Owner-scoped; false when the row isn't the caller's. */
	updateStatus(
		id: string,
		userId: string,
		status: TaskStatus
	): Promise<boolean>;
}

export interface RunStore {
	getById(id: string): Promise<RunRow | null>;
	/** Computer-scoped read; null when the Run isn't on that Computer. */
	getByIdForComputer(id: string, computerId: string): Promise<RunRow | null>;
	getByLaunchKey(launchKey: string): Promise<RunRow | null>;
	insert(input: RunInsert): Promise<RunRow>;
	/** The most recent Run for the Task, or null when it has none. */
	latestByTask(taskId: string): Promise<RunRow | null>;
	/** Chronological (createdAt asc) — Runs are sequential per Task. */
	listByTask(taskId: string): Promise<RunRow[]>;
	/** The Computer's launch queue (D4): its `created` Runs, oldest first.
	 * A Run leaves this list the moment its ack flips it to `launching`. */
	listCreatedByComputer(computerId: string): Promise<RunRow[]>;
	/** False when the Run is unknown; unspecified fields stay untouched. */
	updateStatus(id: string, update: RunStatusUpdate): Promise<boolean>;
}
