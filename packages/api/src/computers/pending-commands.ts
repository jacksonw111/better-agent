import type { BridgeTokenStore } from "@better-agent/agent/ports";
import { buildLaunchCommand } from "@better-agent/agent/task/launch-command";
import type {
	RunLaunchCommand,
	RunRow,
	RunStore,
	TaskStore,
} from "@better-agent/agent/task-ports";

// S2-T2 (design D4): "the queue IS the state". A Computer's pending launch
// commands are simply its still-`created` Runs rendered as Launch payloads —
// there is no separate queue table or unacked-set to keep consistent. The ack
// (runs.ackLaunch) flips a Run to `launching`, which removes it from this
// derivation, so reconnects and heartbeat redelivery are idempotent by
// construction (master spec §15.3). Shared by BOTH delivery paths — the
// /computer-ws push (control-channel.ts) and the heartbeat fallback
// (routers/computers.ts) — so a Computer sees identical payloads either way.

export interface PendingCommandStores {
	bridgeToken: Pick<BridgeTokenStore, "getById">;
	run: Pick<RunStore, "listCreatedByComputer">;
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
	stores: PendingCommandStores,
	computer: PendingCommandComputer,
	run: RunRow
): Promise<RunLaunchCommand | null> {
	if (!run.sessionTokenId) {
		return null;
	}
	const task = await stores.task.getById(run.taskId, computer.userId);
	if (!task) {
		return null;
	}
	const token = await stores.bridgeToken.getById(
		run.sessionTokenId,
		computer.userId
	);
	if (!token?.token || token.revokedAt) {
		return null;
	}
	return buildLaunchCommand(task, run, token.token);
}

export async function buildPendingLaunchCommands(
	stores: PendingCommandStores,
	computer: PendingCommandComputer
): Promise<RunLaunchCommand[]> {
	const created = await stores.run.listCreatedByComputer(computer.id);
	const commands: RunLaunchCommand[] = [];
	for (const run of created) {
		const command = await toLaunchCommand(stores, computer, run);
		if (command) {
			commands.push(command);
		}
	}
	return commands;
}
