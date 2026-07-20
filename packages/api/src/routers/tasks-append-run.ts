import type { BridgeTokenConfig } from "@better-agent/agent/ports";
import { createRunSessionCredential } from "@better-agent/agent/task/run-session-credential";
import type {
	IssueSnapshot,
	RunRow,
	TaskRow,
	WorkspaceKind,
} from "@better-agent/agent/task-ports";
import type { Context } from "../context";

// The one way a new Run joins a Task, shared by tasks.create, tasks.retry and
// tasks.resume (P1) — split out of tasks.ts so the resume router can append
// without importing the whole tasks router (no cycle).

type Services = Context["services"];

export interface AppendRunInput {
	/** Startup config for the Run's pre-issued session credential — the CLI
	 * reads it back on `startSession` and applies it to the launched agent.
	 * `tasks.resume` uses it to carry the previous run's model/permission mode
	 * forward; omitted by cold starts, which launch on the agent's defaults. */
	config?: BridgeTokenConfig;
	/** The snapshots THIS launch resolved — snapshots belong to the Run (§6.15). */
	issueSnapshots: IssueSnapshot[];
	/** P1 (session resume): the previous run's runtime conversation id; the
	 * Launch payload forwards it for a native resume. Omit for cold starts. */
	resumeAgentSessionId?: string | null;
	task: TaskRow;
	workspaceKind: WorkspaceKind;
}

/** Appends the Task's next sequential Run: fresh session credential, fresh
 * pre-generated id so launchKey === run id (the D4 idempotency key). */
export async function appendRun(
	services: Services,
	input: AppendRunInput
): Promise<RunRow> {
	const { task } = input;
	const credential = await createRunSessionCredential({
		bridgeTokenStore: services.stores.bridgeToken,
	})({
		agentKind: task.agentKind,
		config: input.config,
		taskId: task.id,
		userId: task.userId,
	});
	const runId = crypto.randomUUID();
	return await services.stores.run.insert({
		agentKind: task.agentKind,
		branch: null,
		computerId: task.computerId,
		id: runId,
		issueSnapshots: input.issueSnapshots,
		launchKey: runId,
		resumeAgentSessionId: input.resumeAgentSessionId ?? null,
		sessionTokenId: credential.tokenId,
		taskId: task.id,
		workspaceKind: input.workspaceKind,
	});
}
