import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { RunLaunchCommand } from "@better-agent/agent/task-ports";

// S25-T1 (design D5, master spec §9.2): stand-alone workspace preparation.
// A stand-alone Run works in the clean managed directory
// `~/.better-agent/tasks/<taskId>/` — created recursively, and REUSED by a
// retry's new Run (same Task, same directory), which is why creation is
// deliberately idempotent. Repository-backed workspaces are S4-T3: receiving
// one today is a real, reported failure — never a silent fallback to a
// stand-alone directory the Task didn't ask for.

/** What a Launch Command contributes to workspace preparation. */
export type WorkspaceLaunchIntent = Pick<
	RunLaunchCommand,
	"taskId" | "workspace"
>;

/** Injectable for tests; production uses the real home dir + filesystem. */
export interface PrepareWorkspaceDeps {
	homeDir?: () => string;
	mkdirRecursive?: (path: string) => Promise<void>;
}

async function defaultMkdirRecursive(path: string): Promise<void> {
	await mkdir(path, { recursive: true });
}

/** The managed stand-alone workspace directory for a Task (§6.16). */
export function standaloneTaskDir(homeDir: string, taskId: string): string {
	return join(homeDir, ".better-agent", "tasks", taskId);
}

/**
 * Prepares the Run's working directory and returns its absolute path.
 * Stand-alone only in this slice — a repository intent fails with the S4-T3
 * placeholder (a REAL `failed` Run, per §16, not a pretend success). Any
 * filesystem error propagates verbatim so the Run records the true cause.
 */
export function prepareRunWorkspace(
	command: WorkspaceLaunchIntent,
	deps: PrepareWorkspaceDeps = {}
): Promise<string> {
	if (command.workspace.kind === "repository") {
		return Promise.reject(new Error("repository workspaces land in S4-T3"));
	}
	const home = deps.homeDir ?? homedir;
	const mkdirRecursive = deps.mkdirRecursive ?? defaultMkdirRecursive;
	const path = standaloneTaskDir(home(), command.taskId);
	return mkdirRecursive(path).then(() => path);
}
