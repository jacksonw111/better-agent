import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import {
	PROJECT_FS_LIST_MAX_ENTRIES,
	type ProjectFsEntry,
	type ProjectFsListResult,
	type ProjectGitStatusResult,
	type ProjectQueryCommand,
	type ProjectQueryResult,
} from "@better-agent/agent/project-ports";
import { parseStatusPorcelain } from "../git-porcelain";
import { resolveWorkspacePath } from "../workspace-path";
import {
	defaultProjectBasePath,
	type ProjectIndexDeps,
	resolveProjectPath,
} from "./project-dir";
import { defaultGitExec, type GitExec, runGit } from "./repo-cache";

// Q2: the CLI half of the read-only project query loop. A `project_query`
// frame arrives over the control WS, the op runs READ-ONLY inside the
// project checkout (paths confined by workspace-path.ts's realpath-level
// escape checks, git limited to `status`/`log`), and the outcome — result or
// the real execution error — travels back through
// `projects.submitQueryResult`. Never queued, never retried: an unanswerable
// query simply times out server-side.

/** Mirrors projects.submitQueryResult's input. */
export type ProjectQuerySubmitInput =
	| { ok: true; requestId: string; result: ProjectQueryResult }
	| { errorMessage: string; ok: false; requestId: string };

export interface ProjectQueryExecutorDeps extends ProjectIndexDeps {
	/** Managed root; defaults to `~/.better-agent`. */
	basePath?: string;
	exec?: GitExec;
	log(message: string): void;
	submitResult(input: ProjectQuerySubmitInput): Promise<{ ok: boolean }>;
}

export interface ProjectQuerySink {
	/** Executes one query and submits its outcome. Never rejects — even the
	 * execution error is an ANSWER (submitted), not a crash. */
	handle(command: ProjectQueryCommand): Promise<void>;
}

/** Porcelain's `-b` header for a detached HEAD — the one case `branch` is
 * null in the reply. */
const DETACHED_HEAD_BRANCH = "HEAD (no branch)";
/** `%H<unit separator>%s` — a separator no commit subject can contain. */
const LAST_COMMIT_FORMAT = "%H%x1f%s";
const UNIT_SEPARATOR = "\u001f";

async function fileSize(filePath: string): Promise<number | undefined> {
	let size: number | undefined;
	try {
		size = (await stat(filePath)).size;
	} catch {
		size = undefined;
	}
	return size;
}

/** Dirs first then files, alpha within each half, `.git` omitted, capped at
 * PROJECT_FS_LIST_MAX_ENTRIES — sizes stat'd only for the kept files. */
export async function listProjectEntries(
	root: string,
	relPath: string
): Promise<ProjectFsListResult> {
	const target = await resolveWorkspacePath(root, relPath);
	const dirents = await readdir(target, { withFileTypes: true });
	const dirs: ProjectFsEntry[] = [];
	const files: ProjectFsEntry[] = [];
	for (const dirent of dirents) {
		if (dirent.name === ".git") {
			continue;
		}
		const kind = dirent.isDirectory() ? "dir" : "file";
		(kind === "dir" ? dirs : files).push({ kind, name: dirent.name });
	}
	const byName = (a: ProjectFsEntry, b: ProjectFsEntry) =>
		a.name.localeCompare(b.name);
	dirs.sort(byName);
	files.sort(byName);
	const entries = [...dirs, ...files].slice(0, PROJECT_FS_LIST_MAX_ENTRIES);
	await Promise.all(
		entries.map(async (entry) => {
			if (entry.kind === "file") {
				entry.size = await fileSize(join(target, entry.name));
			}
		})
	);
	return { entries };
}

/** `git log -1` parsed into the reply's lastCommit — a non-zero exit (an
 * empty repository) is the answer null, not an error. */
async function readLastCommit(
	exec: GitExec,
	root: string
): Promise<ProjectGitStatusResult["lastCommit"]> {
	const result = await exec(["log", "-1", `--format=${LAST_COMMIT_FORMAT}`], {
		cwd: root,
	});
	if (result.code !== 0) {
		return null;
	}
	const [hash, subject] = result.stdout.trim().split(UNIT_SEPARATOR);
	if (!hash) {
		return null;
	}
	return { hash, subject: subject ?? "" };
}

export async function readGitStatus(
	exec: GitExec,
	root: string
): Promise<ProjectGitStatusResult> {
	const output = await runGit(exec, ["status", "--porcelain=v1", "-b"], {
		cwd: root,
	});
	const summary = parseStatusPorcelain(output);
	const changes = summary.entries.map((entry) => ({
		path: entry.path,
		status: `${entry.x}${entry.y}`,
	}));
	return {
		branch:
			summary.branch === DETACHED_HEAD_BRANCH || summary.branch === ""
				? null
				: summary.branch,
		changes,
		dirty: changes.length > 0,
		lastCommit: await readLastCommit(exec, root),
	};
}

export function errorText(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

export function createProjectQueryHandler(
	deps: ProjectQueryExecutorDeps
): ProjectQuerySink {
	const basePath = deps.basePath ?? defaultProjectBasePath();
	const exec = deps.exec ?? defaultGitExec;

	async function execute(
		command: ProjectQueryCommand
	): Promise<ProjectQueryResult> {
		const root = await resolveProjectPath(basePath, command.projectId, deps);
		if (!root) {
			throw new Error("project is not cloned on this computer");
		}
		if (command.op === "fs_list") {
			return await listProjectEntries(root, command.path ?? "");
		}
		return await readGitStatus(exec, root);
	}

	return {
		async handle(command) {
			let input: ProjectQuerySubmitInput;
			try {
				const result = await execute(command);
				input = { ok: true, requestId: command.requestId, result };
			} catch (error) {
				// The REAL execution error is the answer the web relays verbatim.
				input = {
					errorMessage: errorText(error),
					ok: false,
					requestId: command.requestId,
				};
			}
			try {
				await deps.submitResult(input);
			} catch (error) {
				deps.log(
					`project query ${command.requestId}: submitting the result failed: ${errorText(error)}`
				);
			}
		},
	};
}
