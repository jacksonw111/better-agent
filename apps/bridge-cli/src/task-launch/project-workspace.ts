import { stat } from "node:fs/promises";
import type { ProjectWorkspaceIntent } from "@better-agent/agent/task-ports";
import {
	defaultProjectBasePath,
	type ProjectIndexDeps,
	resolveProjectPath,
} from "./project-dir";

// Q2 (design Q1 §project sessions): a project Run works directly in the
// Project's long-lived checkout — the directory project-clone.ts created and
// recorded in projects/index.json. NO per-session workspace is prepared: the
// whole point of a Project is that every session shares one checkout, so
// preparation is a pure lookup. A missing record or directory fails the Run
// with the real cause (§16) — the server's `ready` gate makes this rare
// (reinstalled machine, user deleted the checkout), never routine.

export interface PrepareProjectWorkspaceDeps extends ProjectIndexDeps {
	/** Managed root; defaults to `~/.better-agent`. */
	basePath?: string;
	exists?: (path: string) => Promise<boolean>;
}

async function defaultExists(path: string): Promise<boolean> {
	try {
		await stat(path);
		return true;
	} catch (error) {
		if ((error as { code?: string } | null)?.code === "ENOENT") {
			return false;
		}
		throw error;
	}
}

/**
 * Resolves the Run's working directory: index.json's recorded checkout path
 * for the projectId. Throws the real error when this computer has no live
 * checkout for the Project.
 */
export async function prepareProjectRunWorkspace(
	workspace: ProjectWorkspaceIntent,
	deps: PrepareProjectWorkspaceDeps = {}
): Promise<string> {
	const basePath = deps.basePath ?? defaultProjectBasePath();
	const exists = deps.exists ?? defaultExists;
	const localPath = await resolveProjectPath(
		basePath,
		workspace.projectId,
		deps
	);
	if (!(localPath && (await exists(localPath)))) {
		throw new Error(
			`Project ${workspace.projectId} is not cloned on this computer — wait for the clone to finish or recreate the project`
		);
	}
	return localPath;
}
