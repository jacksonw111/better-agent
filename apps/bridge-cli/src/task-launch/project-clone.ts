import { join } from "node:path";
import type { ProjectCloneCommand } from "@better-agent/agent/project-ports";
import {
	defaultProjectBasePath,
	type ProjectIndexDeps,
	projectCheckoutDir,
	projectsDir,
	writeProjectIndexEntry,
} from "./project-dir";
import {
	defaultGitExec,
	GIT_ERROR_MAX_CHARS,
	type GitExec,
	runGit,
} from "./repo-cache";

// Q2: the clone_project processor behind both delivery channels (WS push +
// heartbeat pendingCommands), mirroring launch-handler.ts's idempotency
// double-lock: an in-process seen set catches the two channels racing the
// same projectId, and the server's ackClone ok:false catches redelivery
// across restarts. A repo credential, when present, is used for THIS clone
// only: it goes into the clone URL (`https://x-access-token:<token>@…`), the
// remote is rewritten token-free right after, and the token is deliberately
// NOT persisted anywhere (no .git/config, no credential helper, no log) —
// later fetch/push run with the user's/agent's own local git credentials.

/** What the CLI reports back — mirrors projects.reportCloneResult's input. */
export type CloneResultInput =
	| { localPath: string; projectId: string; status: "ready" }
	| { errorMessage: string; projectId: string; status: "error" };

export interface CloneHandlerDeps extends ProjectIndexDeps {
	ackClone(projectId: string): Promise<{ ok: boolean }>;
	/** Managed root; defaults to `~/.better-agent`. */
	basePath?: string;
	exec?: GitExec;
	exists?: (path: string) => Promise<boolean>;
	log(message: string): void;
	reportCloneResult(input: CloneResultInput): Promise<{ ok: boolean }>;
}

/** The clone processor's surface the client loop drives — same fire-without-
 * awaiting contract as LaunchCommandSink. `handle` never rejects. */
export interface CloneCommandSink {
	handle(command: ProjectCloneCommand): Promise<void>;
}

async function defaultExists(path: string): Promise<boolean> {
	const { stat } = await import("node:fs/promises");
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

async function defaultMkdirRecursive(path: string): Promise<void> {
	const { mkdir } = await import("node:fs/promises");
	await mkdir(path, { recursive: true });
}

function errorText(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

/** The token must never leave this process — not in logs, not in an error
 * report. Git normally omits URL credentials from its output, but a message
 * that somehow embeds the raw or URL-encoded token is scrubbed anyway. */
function scrubToken(text: string, token: string | undefined): string {
	if (!token) {
		return text;
	}
	return text
		.split(token)
		.join("***")
		.split(encodeURIComponent(token))
		.join("***");
}

/** `https://x-access-token:<token>@github.com/…` — credentials injected via
 * the URL API so any special characters are encoded correctly. */
function authenticatedCloneUrl(repoCloneUrl: string, token: string): string {
	const url = new URL(repoCloneUrl);
	url.username = "x-access-token";
	url.password = token;
	return url.toString();
}

interface ResolvedCloneDeps
	extends Required<
		Pick<CloneHandlerDeps, "basePath" | "exec" | "exists" | "log">
	> {
	ackClone: CloneHandlerDeps["ackClone"];
	index: ProjectIndexDeps;
	mkdirRecursive: (path: string) => Promise<void>;
	reportCloneResult: CloneHandlerDeps["reportCloneResult"];
}

function resolveDeps(deps: CloneHandlerDeps): ResolvedCloneDeps {
	const mkdirRecursive = deps.mkdirRecursive ?? defaultMkdirRecursive;
	return {
		ackClone: (projectId) => deps.ackClone(projectId),
		basePath: deps.basePath ?? defaultProjectBasePath(),
		exec: deps.exec ?? defaultGitExec,
		exists: deps.exists ?? defaultExists,
		index: {
			mkdirRecursive,
			readTextFile: deps.readTextFile,
			writeTextFile: deps.writeTextFile,
		},
		log: (message) => deps.log(message),
		mkdirRecursive,
		reportCloneResult: (input) => deps.reportCloneResult(input),
	};
}

/** Fresh checkout: clone (with the one-time credentialed URL when a token
 * was delivered), then immediately point origin back at the token-free URL —
 * see the module story for why the token is never persisted. */
async function cloneInto(
	deps: ResolvedCloneDeps,
	command: ProjectCloneCommand,
	dir: string
): Promise<void> {
	await deps.mkdirRecursive(projectsDir(deps.basePath));
	const cloneUrl = command.token
		? authenticatedCloneUrl(command.repoCloneUrl, command.token)
		: command.repoCloneUrl;
	await runGit(deps.exec, ["clone", cloneUrl, dir]);
	if (command.token) {
		await runGit(deps.exec, [
			"-C",
			dir,
			"remote",
			"set-url",
			"origin",
			command.repoCloneUrl,
		]);
	}
}

/** clone (unless the directory is already a git checkout — a redelivery or
 * reinstall just re-reports ready) → record in index.json → report ready. */
async function executeClone(
	deps: ResolvedCloneDeps,
	command: ProjectCloneCommand
): Promise<void> {
	const dir = projectCheckoutDir(
		deps.basePath,
		command.projectId,
		command.repoCloneUrl
	);
	if (await deps.exists(join(dir, ".git"))) {
		deps.log(`project ${command.projectId}: checkout already at ${dir}`);
	} else {
		deps.log(`project ${command.projectId}: cloning ${command.repoCloneUrl}`);
		await cloneInto(deps, command, dir);
	}
	await writeProjectIndexEntry(
		deps.basePath,
		command.projectId,
		dir,
		deps.index
	);
	await deps.reportCloneResult({
		localPath: dir,
		projectId: command.projectId,
		status: "ready",
	});
}

async function reportCloneFailure(
	deps: ResolvedCloneDeps,
	command: ProjectCloneCommand,
	error: unknown
): Promise<void> {
	const errorMessage = scrubToken(errorText(error), command.token).slice(
		0,
		GIT_ERROR_MAX_CHARS
	);
	try {
		await deps.reportCloneResult({
			errorMessage,
			projectId: command.projectId,
			status: "error",
		});
	} catch (reportError) {
		deps.log(
			`project ${command.projectId}: clone failed (${errorMessage}) and the report did not reach the server: ${errorText(reportError)}`
		);
	}
}

export function createCloneHandler(
	rawDeps: CloneHandlerDeps
): CloneCommandSink {
	const deps = resolveDeps(rawDeps);
	const seen = new Set<string>();

	async function process(command: ProjectCloneCommand): Promise<void> {
		const { projectId } = command;
		let acked: boolean;
		try {
			acked = (await deps.ackClone(projectId)).ok;
		} catch (error) {
			// Nothing cloned: clear the seen mark so the server's redelivery (the
			// project is still `created`) gets another chance.
			seen.delete(projectId);
			deps.log(`project ${projectId}: clone ack failed: ${errorText(error)}`);
			return;
		}
		if (!acked) {
			return; // Already handled (possibly by an earlier client process).
		}
		try {
			await executeClone(deps, command);
		} catch (error) {
			await reportCloneFailure(deps, command, error);
		}
	}

	return {
		handle(command) {
			if (seen.has(command.projectId)) {
				return Promise.resolve();
			}
			seen.add(command.projectId);
			return process(command);
		},
	};
}
