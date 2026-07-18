import type { ComputerPendingCommand } from "@better-agent/agent/computer-ports";
import type { SecretBox } from "@better-agent/agent/crypto/secret-box";
import type { BridgeTokenStore } from "@better-agent/agent/ports";
import type {
	ProjectCloneCommand,
	ProjectRow,
	ProjectStore,
} from "@better-agent/agent/project-ports";
import { buildLaunchCommand } from "@better-agent/agent/task/launch-command";
import type {
	RunLaunchCommand,
	RunRow,
	RunStore,
	TaskStore,
} from "@better-agent/agent/task-ports";

// S2-T2 (design D4): "the queue IS the state". A Computer's pending commands
// are simply its still-`created` rows rendered as payloads — no separate
// queue table or unacked-set to keep consistent. Launches: the `created` Runs
// (runs.ackLaunch flips one to `launching`, removing it). Q1 adds clone
// commands the same way: the `created` Projects (projects.ackClone flips one
// to `cloning`). Reconnects and heartbeat redelivery are idempotent by
// construction (master spec §15.3). Shared by BOTH delivery paths — the
// /computer-ws push (control-channel.ts) and the heartbeat fallback
// (routers/computers.ts) — so a Computer sees identical payloads either way.

export interface PendingCommandDeps {
	bridgeToken: Pick<BridgeTokenStore, "getById">;
	project: Pick<ProjectStore, "listCreatedByComputer">;
	run: Pick<RunStore, "listCreatedByComputer">;
	/** Decrypts a Project's stored repo credential into the clone command —
	 * the deliberate one-time delivery to the user's own machine (see
	 * project-ports.ts); server-side GitHub Connection tokens never flow here. */
	secretBox: Pick<SecretBox, "decrypt">;
	task: Pick<TaskStore, "getById">;
}

/** The identity fields needed to scope the owner-guarded task/token reads. */
export interface PendingCommandComputer {
	id: string;
	userId: string;
}

/** Renders one created Run as a Launch Command, or null when the payload
 * cannot be built (missing task or a missing/revoked session credential) —
 * such a Run is undeliverable, never a reason to fail the whole heartbeat. */
async function toLaunchCommand(
	deps: PendingCommandDeps,
	computer: PendingCommandComputer,
	run: RunRow
): Promise<RunLaunchCommand | null> {
	if (!run.sessionTokenId) {
		return null;
	}
	const task = await deps.task.getById(run.taskId, computer.userId);
	if (!task) {
		return null;
	}
	const token = await deps.bridgeToken.getById(
		run.sessionTokenId,
		computer.userId
	);
	if (!token?.token || token.revokedAt) {
		return null;
	}
	return buildLaunchCommand(task, run, token.token);
}

/** Q1: renders one created Project as its clone command. `token` is present
 * only when the user configured a repo credential — decrypted here, right at
 * delivery time, so plaintext never rests anywhere. */
function toCloneCommand(
	deps: PendingCommandDeps,
	project: ProjectRow
): ProjectCloneCommand {
	const command: ProjectCloneCommand = {
		kind: "clone_project",
		projectId: project.id,
		repoCloneUrl: project.repoCloneUrl,
	};
	return project.encryptedToken
		? { ...command, token: deps.secretBox.decrypt(project.encryptedToken) }
		: command;
}

/** All pending control-channel commands for the Computer: clone commands
 * first (a Project must exist on disk before sessions target it), then the
 * launch queue. */
export async function buildPendingCommands(
	deps: PendingCommandDeps,
	computer: PendingCommandComputer
): Promise<ComputerPendingCommand[]> {
	const [createdProjects, createdRuns] = await Promise.all([
		deps.project.listCreatedByComputer(computer.id),
		deps.run.listCreatedByComputer(computer.id),
	]);
	const commands: ComputerPendingCommand[] = createdProjects.map((project) =>
		toCloneCommand(deps, project)
	);
	for (const run of createdRuns) {
		const command = await toLaunchCommand(deps, computer, run);
		if (command) {
			commands.push(command);
		}
	}
	return commands;
}
