import type { RunLaunchCommand } from "@better-agent/agent/task-ports";
import type { LaunchCommandSink } from "../computer-client";
import type { ComputerIdentity } from "../computer-identity";
import type { ComputerTransport } from "../computer-transport";
import { detectComputerInventory } from "../detect-inventory";
import { runControlChannel } from "./control-ws";
import { createLaunchHandler } from "./launch-handler";
import { type CloneCommandSink, createCloneHandler } from "./project-clone";
import { createProjectQueryHandler } from "./project-query";
import { prepareProjectRunWorkspace } from "./project-workspace";
import { prepareRepositoryRunWorkspace } from "./repo-workspace";
import { createRunSessionSupplier } from "./run-session";
import {
	defaultSkillReferenceDeps,
	skillResolverForAgent,
} from "./skill-references";
import { prepareRunWorkspace } from "./standalone-workspace";
import { buildTaskStartContext } from "./start-context";

// S25-T1: the production assembly of the launch pipeline — the one place the
// real filesystem, the real adapters and the real transports meet the
// injectable modules around them. index.ts's `--client` path calls this once
// and hands the result to `runComputerClient`.

export interface TaskLaunchRuntimeConfig {
	log(message: string): void;
	/** The SAME strictly-increasing timestamp source the HTTP transport uses
	 * — the server's replay guard spans both planes (see control-ws.ts). */
	nextTimestamp(): number;
	serverUrl: string;
	/** The client's shutdown signal: aborts every run session on SIGINT. */
	signal: AbortSignal;
	transport: Pick<
		ComputerTransport,
		| "ackClone"
		| "ackLaunch"
		| "reportCloneResult"
		| "submitProjectQueryResult"
		| "updateRunStatus"
	>;
}

/** §10.2 client-side context assembly: fresh installed-tool facts per launch
 * (a binary may appear/vanish between beats), skill resolution only for the
 * runtime whose skill capability is `discoverable` (D2/D6 — claude-code). */
async function buildStartContext(
	command: RunLaunchCommand,
	workspacePath: string
): Promise<string> {
	const { toolInventory } = await detectComputerInventory();
	const resolve = skillResolverForAgent(
		command.agentKind,
		defaultSkillReferenceDeps()
	);
	return buildTaskStartContext(
		{
			description: command.description,
			issueSnapshots: command.issueSnapshots,
			repositoryUrl: command.repositoryUrl,
			toolInventory,
			workspacePath,
		},
		{ resolveSkillReferences: resolve }
	);
}

// D5's workspace fork (§9.2): repository intents go through the shared bare
// cache + per-task worktree; stand-alone intents get the clean managed task
// directory; Q2's project intents resolve to the Project's long-lived
// checkout (project-workspace.ts) — no per-session directory at all. All
// three funnel into the same status sequence.
function prepareCommandWorkspace(command: RunLaunchCommand): Promise<string> {
	const { workspace } = command;
	switch (workspace.kind) {
		case "repository":
			return prepareRepositoryRunWorkspace({
				runId: command.runId,
				taskId: command.taskId,
				workspace,
			});
		case "project":
			return prepareProjectRunWorkspace(workspace);
		default:
			return prepareRunWorkspace({ taskId: command.taskId, workspace });
	}
}

export function createTaskLaunchRuntime(config: TaskLaunchRuntimeConfig): {
	cloneHandler: CloneCommandSink;
	launchHandler: LaunchCommandSink;
	startControlChannel(identity: ComputerIdentity): void;
} {
	const launchHandler = createLaunchHandler({
		ackLaunch: (runId) => config.transport.ackLaunch(runId),
		buildStartContext,
		log: config.log,
		prepareWorkspace: (command) => prepareCommandWorkspace(command),
		runSession: createRunSessionSupplier({ serverUrl: config.serverUrl }),
		signal: config.signal,
		updateRunStatus: (report) => config.transport.updateRunStatus(report),
	});
	// Q2: the clone processor (both delivery channels) and the read-only query
	// executor (WS-only) share the transport's computer-plane oRPC routes.
	const cloneHandler = createCloneHandler({
		ackClone: (projectId) => config.transport.ackClone(projectId),
		log: config.log,
		reportCloneResult: (input) => config.transport.reportCloneResult(input),
	});
	const queryHandler = createProjectQueryHandler({
		log: config.log,
		submitResult: (input) => config.transport.submitProjectQueryResult(input),
	});
	return {
		cloneHandler,
		launchHandler,
		startControlChannel(identity) {
			// Fire-and-forget: the channel loops (with backoff) until the
			// shutdown signal aborts; heartbeat delivery covers any gap.
			runControlChannel({
				identity,
				log: config.log,
				nextTimestamp: config.nextTimestamp,
				onCloneProject: (command) => {
					cloneHandler.handle(command).catch(() => undefined);
				},
				onLaunch: (command) => {
					launchHandler.handle(command).catch(() => undefined);
				},
				onProjectQuery: (command) => {
					queryHandler.handle(command).catch(() => undefined);
				},
				serverUrl: config.serverUrl,
				signal: config.signal,
			}).catch((error: unknown) => {
				config.log(
					`computer control channel stopped: ${error instanceof Error ? error.message : String(error)}`
				);
			});
		},
	};
}
