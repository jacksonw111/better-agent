import type { AppRouter } from "@better-agent/api/routers/index";
import type { RouterClient } from "@orpc/server";
import { client } from "@/utils/orpc";

// Q3 wrap-up: `projects.query` (Q2) is real now, so these options call the
// generated router client directly — the interim locally-typed caller (and
// its cast) is gone. The endpoint's output type is a union of the two op
// results (fs_list | git_status), so each option narrows to its own half
// with a runtime guard before handing the data to the cards.
// Failure modes surfaced by the server: PRECONDITION_FAILED while the
// computer is offline or the project isn't ready, TIMEOUT when the computer
// never answers, and BAD_REQUEST carrying the CLI's execution error verbatim.

type ProjectQueryResult = Awaited<
	ReturnType<RouterClient<AppRouter>["projects"]["query"]>
>;

export type ProjectFsList = Extract<ProjectQueryResult, { entries: unknown }>;
export type ProjectFsEntry = ProjectFsList["entries"][number];
export type ProjectGitStatus = Extract<ProjectQueryResult, { branch: unknown }>;
export type ProjectGitChange = ProjectGitStatus["changes"][number];

function isGitStatus(result: ProjectQueryResult): result is ProjectGitStatus {
	return "branch" in result;
}

/** git_status for one project — branch, dirty, changed files, last commit. */
export function projectGitStatusOptions(projectId: string) {
	return {
		queryKey: ["projects", "query", projectId, "git_status"] as const,
		queryFn: async (): Promise<ProjectGitStatus> => {
			const result = await client.projects.query({
				op: "git_status",
				projectId,
			});
			if (!isGitStatus(result)) {
				throw new Error(
					"projects.query answered a git_status request with an fs_list result"
				);
			}
			return result;
		},
	};
}

/** fs_list for one directory of the checkout ("" = the checkout root). */
export function projectFsListOptions(projectId: string, path: string) {
	return {
		queryKey: ["projects", "query", projectId, "fs_list", path] as const,
		queryFn: async (): Promise<ProjectFsList> => {
			const result = await client.projects.query({
				op: "fs_list",
				path: path === "" ? undefined : path,
				projectId,
			});
			if (isGitStatus(result)) {
				throw new Error(
					"projects.query answered an fs_list request with a git_status result"
				);
			}
			return result;
		},
	};
}
