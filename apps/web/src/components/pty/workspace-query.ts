import type { AppRouter } from "@better-agent/api/routers/index";
import type { RouterClient } from "@orpc/server";
import { client } from "@/utils/orpc";

// DP-WS: query options for the terminal page's Files/Git/Shell side panes, over
// the session-workspace query RPC (pty.query). The endpoint's output is a union
// of the three op results (fs_list | git_status | shell); each option narrows to
// its own half with a runtime guard, mirroring project-query.ts. Failure modes
// (server-side): PRECONDITION_FAILED (offline / session ended / project not
// ready), TIMEOUT (no answer), BAD_REQUEST (the CLI's execution error verbatim).

type WorkspaceQueryResult = Awaited<
	ReturnType<RouterClient<AppRouter>["pty"]["query"]>
>;

export type WorkspaceFsList = Extract<
	WorkspaceQueryResult,
	{ entries: unknown }
>;
export type WorkspaceFsEntry = WorkspaceFsList["entries"][number];
export type WorkspaceGitStatus = Extract<
	WorkspaceQueryResult,
	{ branch: unknown }
>;
export type WorkspaceShellOutcome = Extract<
	WorkspaceQueryResult,
	{ stdout: unknown }
>;

function isGitStatus(
	result: WorkspaceQueryResult
): result is WorkspaceGitStatus {
	return "branch" in result;
}

function isShell(
	result: WorkspaceQueryResult
): result is WorkspaceShellOutcome {
	return "stdout" in result;
}

/** git_status for the session's workspace. */
export function workspaceGitStatusOptions(sessionId: string) {
	return {
		queryKey: ["pty", "query", sessionId, "git_status"] as const,
		queryFn: async (): Promise<WorkspaceGitStatus> => {
			const result = await client.pty.query({ op: "git_status", sessionId });
			if (!isGitStatus(result)) {
				throw new Error("pty.query answered git_status with the wrong result");
			}
			return result;
		},
	};
}

/** fs_list for one directory of the session's workspace ("" = the root). */
export function workspaceFsListOptions(sessionId: string, path: string) {
	return {
		queryKey: ["pty", "query", sessionId, "fs_list", path] as const,
		queryFn: async (): Promise<WorkspaceFsList> => {
			const result = await client.pty.query({
				op: "fs_list",
				path: path === "" ? undefined : path,
				sessionId,
			});
			if (isGitStatus(result) || isShell(result)) {
				throw new Error("pty.query answered fs_list with the wrong result");
			}
			return result;
		},
	};
}

/** Runs one shell command in the session's workspace and returns its output. */
export function runWorkspaceShell(
	sessionId: string,
	cmd: string
): Promise<WorkspaceShellOutcome> {
	return client.pty.query({ cmd, op: "shell", sessionId }).then((result) => {
		if (!isShell(result)) {
			throw new Error("pty.query answered shell with the wrong result");
		}
		return result;
	});
}

/** The workspace label + availability gate for the panes. */
export function workspaceInfoOptions(sessionId: string) {
	return {
		queryKey: ["pty", "workspace", sessionId] as const,
		queryFn: () => client.pty.workspace({ sessionId }),
	};
}
