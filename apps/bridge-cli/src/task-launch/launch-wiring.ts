import type { RunLaunchCommand } from "@better-agent/agent/task-ports";
import type { LaunchCommandSink } from "../computer-client";
import type { ComputerIdentity } from "../computer-identity";
import type { ComputerTransport } from "../computer-transport";
import { detectComputerInventory } from "../detect-inventory";
import { runControlChannel } from "./control-ws";
import { createLaunchHandler } from "./launch-handler";
import { createRunSessionSupplier } from "./run-session";
import {
	defaultSkillReferenceDeps,
	resolveSkillReferences,
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
	transport: Pick<ComputerTransport, "ackLaunch" | "updateRunStatus">;
}

/** §10.2 client-side context assembly: fresh installed-tool facts per launch
 * (a binary may appear/vanish between beats), skill resolution only for the
 * runtime whose skill capability is `discoverable` (D2/D6 — claude-code). */
async function buildStartContext(
	command: RunLaunchCommand,
	workspacePath: string
): Promise<string> {
	const { toolInventory } = await detectComputerInventory();
	const resolve =
		command.agentKind === "claude-code"
			? (description: string) =>
					resolveSkillReferences(description, defaultSkillReferenceDeps())
			: (description: string) => Promise.resolve(description);
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

export function createTaskLaunchRuntime(config: TaskLaunchRuntimeConfig): {
	launchHandler: LaunchCommandSink;
	startControlChannel(identity: ComputerIdentity): void;
} {
	const launchHandler = createLaunchHandler({
		ackLaunch: (runId) => config.transport.ackLaunch(runId),
		buildStartContext,
		log: config.log,
		prepareWorkspace: prepareRunWorkspace,
		runSession: createRunSessionSupplier({ serverUrl: config.serverUrl }),
		signal: config.signal,
		updateRunStatus: (report) => config.transport.updateRunStatus(report),
	});
	return {
		launchHandler,
		startControlChannel(identity) {
			// Fire-and-forget: the channel loops (with backoff) until the
			// shutdown signal aborts; heartbeat delivery covers any gap.
			runControlChannel({
				identity,
				log: config.log,
				nextTimestamp: config.nextTimestamp,
				onLaunch: (command) => {
					launchHandler.handle(command).catch(() => undefined);
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
