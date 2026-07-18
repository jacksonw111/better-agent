import { client } from "@/utils/orpc";

// Q3: the `projects.query` out-of-band read contract — the bridge relays it
// to the project's computer, which answers from the live checkout. The
// endpoint is being implemented alongside this UI (bridge/api side), so the
// call goes through a locally-typed caller instead of the generated router
// client; once `projects.query` lands in AppRouter this cast disappears.
// Failure modes surfaced by the server: PRECONDITION_FAILED while the
// computer is offline, and a timeout error when it never answers.

export interface ProjectFsEntry {
	kind: "dir" | "file";
	name: string;
	size?: number;
}

export interface ProjectFsList {
	entries: ProjectFsEntry[];
}

export interface ProjectGitChange {
	path: string;
	status: string;
}

export interface ProjectGitStatus {
	branch: string;
	changes: ProjectGitChange[];
	dirty: boolean;
	lastCommit: { hash: string; subject: string } | null;
}

interface ProjectQueryCaller {
	query: ((input: {
		op: "fs_list";
		path?: string;
		projectId: string;
	}) => Promise<ProjectFsList>) &
		((input: {
			op: "git_status";
			projectId: string;
		}) => Promise<ProjectGitStatus>);
}

function caller(): ProjectQueryCaller {
	return client.projects as unknown as ProjectQueryCaller;
}

/** git_status for one project — branch, dirty, changed files, last commit. */
export function projectGitStatusOptions(projectId: string) {
	return {
		queryKey: ["projects", "query", projectId, "git_status"] as const,
		queryFn: () => caller().query({ op: "git_status", projectId }),
	};
}

/** fs_list for one directory of the checkout ("" = the checkout root). */
export function projectFsListOptions(projectId: string, path: string) {
	return {
		queryKey: ["projects", "query", projectId, "fs_list", path] as const,
		queryFn: () =>
			caller().query({
				op: "fs_list",
				path: path === "" ? undefined : path,
				projectId,
			}),
	};
}
