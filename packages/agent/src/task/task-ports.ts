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

/** Where a Run works: a git-worktree-backed repository checkout, or a clean
 * managed task directory when the Task has no repository (§6.16). */
export type WorkspaceKind = "repository" | "standalone";

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
	repositoryFullName: string | null;
	repositoryUrl: string | null;
	userId: string;
}

export interface TaskRow extends TaskInsert {
	createdAt: Date;
	id: string;
	status: TaskStatus;
	updatedAt: Date;
}

export interface RunInsert {
	agentKind: BridgeAgentKind;
	branch: string | null;
	computerId: string;
	issueSnapshots: IssueSnapshot[];
	/** Idempotency key for Launch delivery — equals the run id (D4). */
	launchKey: string;
	taskId: string;
	workspaceKind: WorkspaceKind;
}

export interface RunRow extends RunInsert {
	createdAt: Date;
	errorMessage: string | null;
	id: string;
	/** Relay binding — set once the client attaches the runtime to its
	 * pre-issued bridge session (D4). */
	sessionId: string | null;
	status: RunStatus;
	updatedAt: Date;
	/** The client-reported local workspace path, once prepared. */
	workspacePath: string | null;
}

/** Partial status update from the client: only provided fields change. */
export interface RunStatusUpdate {
	errorMessage?: string | null;
	sessionId?: string;
	status: RunStatus;
	workspacePath?: string;
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
	getByLaunchKey(launchKey: string): Promise<RunRow | null>;
	insert(input: RunInsert): Promise<RunRow>;
	/** The most recent Run for the Task, or null when it has none. */
	latestByTask(taskId: string): Promise<RunRow | null>;
	/** Chronological (createdAt asc) — Runs are sequential per Task. */
	listByTask(taskId: string): Promise<RunRow[]>;
	/** False when the Run is unknown; unspecified fields stay untouched. */
	updateStatus(id: string, update: RunStatusUpdate): Promise<boolean>;
}
