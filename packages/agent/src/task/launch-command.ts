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
	"description" | "id" | "repositoryFullName" | "repositoryUrl"
>;

/** The Run fields a Launch Command derives from. */
export type LaunchRunSource = Pick<
	RunRow,
	"agentKind" | "id" | "issueSnapshots" | "workspaceKind"
>;

const GIT_URL_SUFFIX = ".git";

/** Placeholder until S4 threads GitHub-resolved repository metadata (real
 * default branch) into Task creation. Repository Tasks cannot be created
 * before the wizard's GitHub step lands in S4, so no production Launch can
 * reach this fallback. */
const ASSUMED_DEFAULT_BRANCH = "main";

function repositoryIntent(task: LaunchTaskSource): RunWorkspaceIntent {
	if (!(task.repositoryFullName && task.repositoryUrl)) {
		throw new Error(
			`Task ${task.id} has a repository run but no repository identity`
		);
	}
	const cloneUrl = task.repositoryUrl.endsWith(GIT_URL_SUFFIX)
		? task.repositoryUrl
		: `${task.repositoryUrl}${GIT_URL_SUFFIX}`;
	return {
		kind: "repository",
		fullName: task.repositoryFullName,
		cloneUrl,
		defaultBranch: ASSUMED_DEFAULT_BRANCH,
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
	return {
		kind: "launch",
		taskId: task.id,
		runId: run.id,
		agentKind: run.agentKind,
		workspace,
		description: task.description,
		issueSnapshots: run.issueSnapshots,
		sessionCredential: sessionToken,
	};
}
