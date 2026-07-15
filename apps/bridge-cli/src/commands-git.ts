// P4-T4: the git control commands' types + parser — split out of
// commands-control.ts to keep that file under the repo's 300-line cap (same
// precedent as commands-question.ts). All three carry the web-minted
// `requestId` echoed back on their `git_status`/`git_diff`/`git_commit` reply
// status events (fs-reader-style correlation, see git-runner.ts).

/** The Git tab's status refresh. Routed to `CommandSink.gitStatus`. */
export interface ControlGitStatusCommand {
	action: "gitStatus";
	requestId: string;
	type: "control";
}

/** The Git tab's diff view — `path` limits the diff to one workspace-relative
 * file; absent means the whole tree. Replied as chunked `git_diff` events.
 * Routed to `CommandSink.gitDiff`. */
export interface ControlGitDiffCommand {
	action: "gitDiff";
	path?: string;
	requestId: string;
	type: "control";
}

/** The Git tab's commit box — v1 commits ALL working-tree changes (`git add
 * -A`, the web button says so). `message` travels as one argv element, never
 * through a shell. Routed to `CommandSink.gitCommit`. */
export interface ControlGitCommitCommand {
	action: "gitCommit";
	message: string;
	requestId: string;
	type: "control";
}

export type GitControlCommand =
	| ControlGitCommitCommand
	| ControlGitDiffCommand
	| ControlGitStatusCommand;

/** `{ action: "gitStatus" | "gitDiff" | "gitCommit", requestId, ... }` —
 * requestId always mandatory; `gitDiff.path` optional, `gitCommit.message`
 * mandatory. Unrecognized/malformed → null, same contract as the sibling
 * parsers in commands-control.ts. */
export function parseGitControlCommand(
	data: Record<string, unknown>
): GitControlCommand | null {
	if (typeof data.requestId !== "string") {
		return null;
	}
	const { requestId } = data;
	if (data.action === "gitStatus") {
		return { action: "gitStatus", requestId, type: "control" };
	}
	if (data.action === "gitDiff") {
		const path = typeof data.path === "string" ? data.path : undefined;
		return { action: "gitDiff", path, requestId, type: "control" };
	}
	if (data.action === "gitCommit" && typeof data.message === "string") {
		return {
			action: "gitCommit",
			message: data.message,
			requestId,
			type: "control",
		};
	}
	return null;
}
