import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type {
	RunLaunchCommand,
	StandaloneWorkspaceIntent,
} from "@better-agent/agent/task-ports";

// S25-T1 (design D5, master spec §9.2): stand-alone workspace preparation.
// A stand-alone Run works in the clean managed directory
// `~/.better-agent/tasks/<taskId>/` — created recursively, and REUSED by a
// retry's new Run (same Task, same directory), which is why creation is
// deliberately idempotent. Repository-backed workspaces live in
// repo-workspace.ts (S4-T3); launch-wiring.ts routes on the workspace kind,
// and the type below only admits stand-alone intents.

/** What a stand-alone Launch Command contributes to workspace preparation. */
export type WorkspaceLaunchIntent = Pick<RunLaunchCommand, "taskId"> & {
	workspace: StandaloneWorkspaceIntent;
};

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
 * Prepares a stand-alone Run's working directory and returns its absolute
 * path. Any filesystem error propagates verbatim so the Run records the
 * true cause (§16).
 */
export function prepareRunWorkspace(
	command: WorkspaceLaunchIntent,
	deps: PrepareWorkspaceDeps = {}
): Promise<string> {
	const home = deps.homeDir ?? homedir;
	const mkdirRecursive = deps.mkdirRecursive ?? defaultMkdirRecursive;
	const path = standaloneTaskDir(home(), command.taskId);
	return mkdirRecursive(path).then(() => path);
}
