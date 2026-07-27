import { spawn } from "node:child_process";
import { homedir } from "node:os";
import {
	type ProjectQueryResult,
	WORKSPACE_SHELL_MAX_OUTPUT_BYTES,
	WORKSPACE_SHELL_TIMEOUT_MS,
	type WorkspaceQueryCommand,
	type WorkspaceShellResult,
} from "@better-agent/agent/project-ports";
import {
	errorText,
	listProjectEntries,
	type ProjectQuerySubmitInput,
	readGitStatus,
} from "./project-query";
import { defaultGitExec, type GitExec } from "./repo-cache";

const MS_PER_SECOND = 1000;

// DP-WS: the CLI half of the session-workspace query loop (pty.query). A
// `workspace_query` frame arrives over the control WS; the op runs inside the
// session's workspace — the project checkout, or the home dir when
// `workspaceRoot` is "" (a project-less session) — and the outcome travels back
// through `projects.submitQueryResult` (the SAME answer path as the project
// loop). fs_list/git_status reuse the project executor verbatim; `shell` runs
// one BOUNDED command in the workspace cwd: output capped at
// WORKSPACE_SHELL_MAX_OUTPUT_BYTES per stream, killed past
// WORKSPACE_SHELL_TIMEOUT_MS, never queued or retried.

/** Runs one shell command in `cwd` and resolves its bounded result — never
 * rejects (a spawn error becomes an ok answer with exitCode null). Injectable
 * so tests drive it without a real subprocess. */
export type WorkspaceShellRunner = (
	cwd: string,
	cmd: string
) => Promise<WorkspaceShellResult>;

/** Appends `chunk` to `existing` up to the per-stream byte cap; flips
 * `state.truncated` once the cap is hit and drops the overflow. */
function appendCapped(
	existing: string,
	chunk: Buffer,
	state: { truncated: boolean }
): string {
	const room = WORKSPACE_SHELL_MAX_OUTPUT_BYTES - Buffer.byteLength(existing);
	if (room <= 0) {
		state.truncated = true;
		return existing;
	}
	const text = chunk.toString("utf8");
	if (Buffer.byteLength(text) <= room) {
		return existing + text;
	}
	state.truncated = true;
	return existing + text.slice(0, room);
}

const defaultRunShell: WorkspaceShellRunner = (cwd, cmd) =>
	new Promise<WorkspaceShellResult>((resolve) => {
		const state = { truncated: false };
		let stdout = "";
		let stderr = "";
		let timedOut = false;
		// `shell: true` runs the command line through the platform shell, in the
		// workspace cwd — the whole point of the pane (a scratch shell that never
		// disturbs the agent's own terminal above).
		const child = spawn(cmd, { cwd, shell: true });
		const timer = setTimeout(() => {
			timedOut = true;
			child.kill("SIGKILL");
		}, WORKSPACE_SHELL_TIMEOUT_MS);
		child.stdout?.on("data", (chunk: Buffer) => {
			stdout = appendCapped(stdout, chunk, state);
		});
		child.stderr?.on("data", (chunk: Buffer) => {
			stderr = appendCapped(stderr, chunk, state);
		});
		child.on("error", (error) => {
			clearTimeout(timer);
			resolve({
				exitCode: null,
				stderr: stderr + errorText(error),
				stdout,
				truncated: state.truncated,
			});
		});
		child.on("close", (code) => {
			clearTimeout(timer);
			resolve({
				exitCode: timedOut ? null : code,
				stderr: timedOut
					? `${stderr}\n[killed after ${WORKSPACE_SHELL_TIMEOUT_MS / MS_PER_SECOND}s]`
					: stderr,
				stdout,
				truncated: state.truncated,
			});
		});
	});

export interface WorkspaceQueryExecutorDeps {
	exec?: GitExec;
	/** The home dir a `""` workspaceRoot resolves to; injectable for tests. */
	homeDir?: () => string;
	log(message: string): void;
	runShell?: WorkspaceShellRunner;
	submitResult(input: ProjectQuerySubmitInput): Promise<{ ok: boolean }>;
}

export interface WorkspaceQuerySink {
	/** Executes one workspace query and submits its outcome. Never rejects —
	 * even the execution error is an ANSWER (submitted ok:false), not a crash. */
	handle(command: WorkspaceQueryCommand): Promise<void>;
}

export function createWorkspaceQueryHandler(
	deps: WorkspaceQueryExecutorDeps
): WorkspaceQuerySink {
	const exec = deps.exec ?? defaultGitExec;
	const resolveHome = deps.homeDir ?? homedir;
	const runShell = deps.runShell ?? defaultRunShell;

	function execute(
		command: WorkspaceQueryCommand
	): Promise<ProjectQueryResult> {
		const root =
			command.workspaceRoot === "" ? resolveHome() : command.workspaceRoot;
		if (command.op === "fs_list") {
			return listProjectEntries(root, command.path ?? "");
		}
		if (command.op === "git_status") {
			return readGitStatus(exec, root);
		}
		if (!command.cmd) {
			return Promise.reject(new Error("shell query missing command"));
		}
		return runShell(root, command.cmd);
	}

	return {
		async handle(command) {
			let input: ProjectQuerySubmitInput;
			try {
				const result = await execute(command);
				input = { ok: true, requestId: command.requestId, result };
			} catch (error) {
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
					`workspace query ${command.requestId}: submitting the result failed: ${errorText(error)}`
				);
			}
		},
	};
}
