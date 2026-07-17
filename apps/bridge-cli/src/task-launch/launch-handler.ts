import type {
	RunLaunchCommand,
	RunStatus,
} from "@better-agent/agent/task-ports";

// S25-T1: the SINGLE launch processor behind both delivery channels — the
// /computer-ws push and the heartbeat `pendingCommands` fallback hand the
// same payload to the same `handle`. Idempotency is double-locked (§15.3):
// an in-process seen set catches the two channels racing the same runId
// inside this process, and the server's `runs.ackLaunch` ok:false catches
// redelivery across restarts — the same runId NEVER starts a second runtime
// process. Every failure reports `failed` with the REAL error (§16), and a
// clean session end reports `stopped`.

/** The client-reportable subset of `RunStatus` this handler emits. */
export type ReportableRunStatus = Extract<
	RunStatus,
	"preparing_workspace" | "starting_runtime" | "running" | "stopped" | "failed"
>;

export interface RunStatusReport {
	errorMessage?: string;
	runId: string;
	status: ReportableRunStatus;
	workspacePath?: string;
}

/** What `runSession` needs to start one Run's runtime + relay. */
export interface RunSessionRequest {
	agentKind: RunLaunchCommand["agentKind"];
	/** P2: the previous Run's runtime conversation id — run-session threads it
	 * to the adapter's native resume (`StartOptions.resume`). Absent for cold
	 * starts. */
	resumeAgentSessionId?: string;
	runId: string;
	sessionCredential: string;
	signal: AbortSignal;
	/** The assembled Task Start Context to inject as the first user input —
	 * empty string means "inject nothing" (P2: resume launches and empty
	 * descriptions). */
	startContext: string;
	taskId: string;
	workspacePath: string;
}

/** A successfully started run session: `done` settles when it ends — resolve
 * for a clean end (agent exited / web stop), reject with the real error. */
export interface StartedRunSession {
	done: Promise<void>;
}

export type RunSessionSupplier = (
	request: RunSessionRequest
) => Promise<StartedRunSession>;

export interface LaunchHandlerDeps {
	ackLaunch(runId: string): Promise<{ ok: boolean }>;
	buildStartContext(
		command: RunLaunchCommand,
		workspacePath: string
	): Promise<string>;
	log(message: string): void;
	prepareWorkspace(command: RunLaunchCommand): Promise<string>;
	runSession: RunSessionSupplier;
	/** Aborted on SIGINT/SIGTERM — every run session winds down with it. */
	signal: AbortSignal;
	updateRunStatus(report: RunStatusReport): Promise<unknown>;
}

export interface LaunchCommandHandler {
	/** Processes one delivered Launch Command to completion. Never rejects —
	 * every failure is reported through `updateRunStatus` instead. Callers
	 * (heartbeat loop, WS channel) fire it without awaiting. */
	handle(command: RunLaunchCommand): Promise<void>;
	/** Resolves once every in-flight run session has wound down — the
	 * shutdown path awaits this so final status reports get out. */
	settle(): Promise<void>;
}

function errorText(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

/** P2: the Task Start Context is only assembled (and later injected by
 * run-session) for a COLD start with a real description — a resumed
 * conversation already carries its history, and an empty description would
 * only inject an empty message. */
function needsStartContext(command: RunLaunchCommand): boolean {
	return !command.resumeAgentSessionId && command.description.trim() !== "";
}

/** The launch execution sequence (design fix): preparing_workspace → prepare
 * → starting_runtime(workspacePath) → assemble context → start runtime +
 * relay → running → (session end) stopped. Any throw lands in `handle`'s
 * failure report. */
async function executeRun(
	command: RunLaunchCommand,
	deps: LaunchHandlerDeps
): Promise<void> {
	const { runId } = command;
	await deps.updateRunStatus({ runId, status: "preparing_workspace" });
	const workspacePath = await deps.prepareWorkspace(command);
	await deps.updateRunStatus({
		runId,
		status: "starting_runtime",
		workspacePath,
	});
	const startContext = needsStartContext(command)
		? await deps.buildStartContext(command, workspacePath)
		: "";
	const session = await deps.runSession({
		agentKind: command.agentKind,
		resumeAgentSessionId: command.resumeAgentSessionId,
		runId,
		sessionCredential: command.sessionCredential,
		signal: deps.signal,
		startContext,
		taskId: command.taskId,
		workspacePath,
	});
	await deps.updateRunStatus({ runId, status: "running" });
	await session.done;
	await deps.updateRunStatus({ runId, status: "stopped" });
}

/** Reports the REAL failure; when even the report can't get out, the error
 * is logged locally rather than silently dropped. */
async function reportFailure(
	deps: LaunchHandlerDeps,
	runId: string,
	error: unknown
): Promise<void> {
	const errorMessage = errorText(error);
	try {
		await deps.updateRunStatus({ errorMessage, runId, status: "failed" });
	} catch (reportError) {
		deps.log(
			`run ${runId}: failed (${errorMessage}) and the report did not reach the server: ${errorText(reportError)}`
		);
	}
}

export function createLaunchHandler(
	deps: LaunchHandlerDeps
): LaunchCommandHandler {
	const seen = new Set<string>();
	const active = new Map<string, Promise<void>>();

	async function process(command: RunLaunchCommand): Promise<void> {
		const { runId } = command;
		let acked: boolean;
		try {
			acked = (await deps.ackLaunch(runId)).ok;
		} catch (error) {
			// Nothing started: clear the seen mark so the server's redelivery
			// (the run is still `created`) gets another chance.
			seen.delete(runId);
			deps.log(`run ${runId}: launch ack failed: ${errorText(error)}`);
			return;
		}
		if (!acked) {
			return; // Already handled (possibly by an earlier client process).
		}
		try {
			await executeRun(command, deps);
		} catch (error) {
			await reportFailure(deps, runId, error);
		}
	}

	return {
		handle(command) {
			const { runId } = command;
			if (seen.has(runId)) {
				return Promise.resolve();
			}
			seen.add(runId);
			// Registered synchronously so `settle` always observes it.
			const running = process(command).finally(() => {
				active.delete(runId);
			});
			active.set(runId, running);
			return running;
		},
		async settle() {
			while (active.size > 0) {
				await Promise.allSettled([...active.values()]);
			}
		},
	};
}
