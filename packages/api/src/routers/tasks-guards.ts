import {
	COMPUTER_OFFLINE_AFTER_MS,
	type ComputerRow,
} from "@better-agent/agent/computer-ports";
import type { BridgeAgentKind } from "@better-agent/agent/ports";
import { ORPCError } from "@orpc/server";
import type { Context } from "../context";

// Task Start preconditions and delivery helpers (S2-T3, master spec §8.5):
// the computer/runtime gates that run BEFORE any write, and the best-effort
// WS notify whose failure never rolls a saved Start back.

type Services = Context["services"];

/** §8.5 step 2: the computer must be the caller's (unknown and foreign look
 * identical — no oracle) and currently connected. The first version never
 * queues a Start for an offline computer. */
export async function requireOnlineOwnedComputer(
	services: Services,
	userId: string,
	computerId: string
): Promise<ComputerRow> {
	const computer = await services.stores.computer.getById(computerId);
	if (!computer || computer.userId !== userId) {
		throw new ORPCError("NOT_FOUND", { message: "Computer not found" });
	}
	if (Date.now() - computer.lastSeenAt.getTime() > COMPUTER_OFFLINE_AFTER_MS) {
		throw new ORPCError("PRECONDITION_FAILED", {
			message: "Computer is offline — reconnect it or pick another one",
		});
	}
	return computer;
}

/** §8.5 step 3: the runtime must come from the computer's own inventory.
 * Deliberately the ONLY tool gate — git/gh presence or authentication is
 * never preflighted (§16); real command errors reach the Agent instead. */
export function requireRuntimeInInventory(
	computer: ComputerRow,
	agentKind: BridgeAgentKind
): void {
	const available = computer.runtimeInventory.some(
		(item) => item.agentKind === agentKind
	);
	if (!available) {
		throw new ORPCError("BAD_REQUEST", {
			message: `Agent runtime ${agentKind} is not in this computer's inventory`,
		});
	}
}

/** §8.5 step 10: best-effort WS push. A failure never rolls the Start back —
 * the run is already queued, and heartbeat pendingCommands delivers it within
 * one interval (D4 fallback). */
export async function notifyComputerBestEffort(
	services: Services,
	computerId: string
): Promise<void> {
	try {
		await services.computerControl.notifyComputer(computerId);
	} catch {
		// Swallowed on purpose: the heartbeat fallback is the delivery guarantee.
	}
}
