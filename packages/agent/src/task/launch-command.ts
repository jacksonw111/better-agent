// Launch Command assembly (S2-T2, master spec §9.1 / design D4): a pure
// derivation from the Task, the Run and the Run's pre-issued session
// credential. The server pushes the result over the computer control WS and
// returns it as heartbeat `pendingCommands`; both paths build it the same way
// so a Computer sees an identical payload however it is delivered.

import type {
	RunLaunchCommand,
	RunRow,
	RunWorkspaceIntent,
	TaskRow,
} from "./task-ports";

/** The Task fields a Launch Command derives from. */
export type LaunchTaskSource = Pick<
	TaskRow,
	| "description"
	| "id"
	| "repositoryCloneUrl"
	| "repositoryDefaultBranch"
	| "repositoryFullName"
	| "repositoryUrl"
>;

/** The Run fields a Launch Command derives from. */
export type LaunchRunSource = Pick<
	RunRow,
	| "agentKind"
	| "id"
	| "issueSnapshots"
	| "resumeAgentSessionId"
	| "workspaceKind"
>;

/** S4-T2: the repository intent carries the GitHub-resolved metadata saved at
 * Task creation — the real cloneUrl and defaultBranch, never a derived URL or
 * an assumed "main" (the pre-S4 fallback is gone on purpose). */
function repositoryIntent(task: LaunchTaskSource): RunWorkspaceIntent {
	const { repositoryCloneUrl, repositoryDefaultBranch, repositoryFullName } =
		task;
	if (!(repositoryFullName && repositoryCloneUrl && repositoryDefaultBranch)) {
		throw new Error(
			`Task ${task.id} has a repository run but incomplete repository metadata`
		);
	}
	return {
		kind: "repository",
		fullName: repositoryFullName,
		cloneUrl: repositoryCloneUrl,
		defaultBranch: repositoryDefaultBranch,
	};
}

/** Builds the Launch Command for `run`. `sessionToken` is the raw `bt_…`
 * credential pre-issued at Run creation (see run-session-credential.ts). */
export function buildLaunchCommand(
	task: LaunchTaskSource,
	run: LaunchRunSource,
	sessionToken: string
): RunLaunchCommand {
	const workspace: RunWorkspaceIntent =
		run.workspaceKind === "repository"
			? repositoryIntent(task)
			: { kind: "standalone" };
	const command: RunLaunchCommand = {
		kind: "launch",
		taskId: task.id,
		runId: run.id,
		agentKind: run.agentKind,
		workspace,
		description: task.description,
		issueSnapshots: run.issueSnapshots,
		repositoryUrl: task.repositoryUrl,
		sessionCredential: sessionToken,
	};
	// P1 (session resume): present only when the Run was created by
	// tasks.resume off a previous run that reported a conversation id — a cold
	// start's payload omits the key entirely, never carries a null.
	return run.resumeAgentSessionId
		? { ...command, resumeAgentSessionId: run.resumeAgentSessionId }
		: command;
}
