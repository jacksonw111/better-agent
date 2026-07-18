import {
	COMPUTER_OFFLINE_AFTER_MS,
	type ComputerRow,
} from "@better-agent/agent/computer-ports";
import type { BridgeAgentKind } from "@better-agent/agent/ports";
import type { ProjectRow } from "@better-agent/agent/project-ports";
import { ORPCError } from "@orpc/server";
import type { Context } from "../context";
import { resolveGithubStartContext } from "./tasks-github-context";

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

/** Q1: a project session's Project must be the caller's, live on the SAME
 * Computer the session starts on, and be `ready` (cloned, path reported) —
 * a queued/cloning/errored checkout can never host a session. Runs BEFORE
 * any write, like every other Start gate. */
export async function requireReadyProject(
	services: Services,
	userId: string,
	projectId: string,
	computerId: string
): Promise<ProjectRow> {
	const project = await services.stores.project.getById(projectId, userId);
	if (!project) {
		throw new ORPCError("NOT_FOUND", { message: "Project not found" });
	}
	if (project.computerId !== computerId) {
		throw new ORPCError("PRECONDITION_FAILED", {
			message: "Project lives on a different computer",
		});
	}
	if (project.status !== "ready") {
		throw new ORPCError("PRECONDITION_FAILED", {
			message: "Project is not ready — wait for the clone to finish",
		});
	}
	return project;
}

/** Q1 + §8.5 steps 4–5: the project gate and the GitHub context, resolved
 * together and still BEFORE any write like every other Start check. A project
 * session excludes an explicit repository — the Project already IS one. */
export async function resolveProjectAndGithub(
	services: Services,
	userId: string,
	computerId: string,
	input: {
		issueNumbers?: number[];
		projectId?: string;
		repositoryFullName?: string;
	}
) {
	if (input.projectId && input.repositoryFullName) {
		throw new ORPCError("BAD_REQUEST", {
			message:
				"A project session already has its repository — omit repositoryFullName",
		});
	}
	const project = input.projectId
		? await requireReadyProject(services, userId, input.projectId, computerId)
		: null;
	const { issueSnapshots, repository } = await resolveGithubStartContext(
		services,
		userId,
		input
	);
	return { issueSnapshots, project, repository };
}

/** Q1: a project session runs in the Project's checkout; otherwise the
 * repository/stand-alone split is unchanged. */
export function resolveWorkspaceKind(
	hasProject: boolean,
	hasRepository: boolean
): "project" | "repository" | "standalone" {
	if (hasProject) {
		return "project";
	}
	return hasRepository ? "repository" : "standalone";
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
