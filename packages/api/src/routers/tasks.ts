import {
	COMPUTER_OFFLINE_AFTER_MS,
	type ComputerRow,
} from "@better-agent/agent/computer-ports";
import { assembleOpeningMessage } from "@better-agent/agent/task/opening-message";
import { createRunSessionCredential } from "@better-agent/agent/task/run-session-credential";
import type {
	RunRow,
	TaskRow,
	WorkspaceKind,
} from "@better-agent/agent/task-ports";
import { ORPCError } from "@orpc/server";
import { z } from "zod";
import type { Context } from "../context";
import { authorizedUserProcedure } from "../index";

// Tasks router (S2-T3): atomic Start per master spec §8.5 — every validation
// runs BEFORE the first write, so a rejected Start leaves no task/run rows;
// once task + opening message + first Run are saved, a failed notify never
// rolls them back (heartbeat pendingCommands delivers instead, D4). Retry
// (§16) appends a NEW sequential Run to the same Task — the Task's verbatim
// description and opening message are never copied or rewritten.

const AGENT_KINDS = ["claude-code", "opencode", "codex", "pi"] as const;
const TASK_NAME_MAX_LENGTH = 120;
const RETRYABLE_STATUSES: ReadonlySet<RunRow["status"]> = new Set([
	"failed",
	"stopped",
]);

const hasVisibleText = (value: string) => value.trim().length > 0;

type Services = Context["services"];

/** §8.5 step 2: the computer must be the caller's (unknown and foreign look
 * identical — no oracle) and currently connected. The first version never
 * queues a Start for an offline computer. */
async function requireOnlineOwnedComputer(
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
function requireRuntimeInInventory(
	computer: ComputerRow,
	agentKind: (typeof AGENT_KINDS)[number]
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

/** Appends the Task's next sequential Run: fresh session credential, fresh
 * pre-generated id so launchKey === run id (the D4 idempotency key). Issue
 * snapshots are re-fetched per Run at launch — no GitHub in this slice, so
 * always empty until S4-T2. */
async function appendRun(
	services: Services,
	task: TaskRow,
	workspaceKind: WorkspaceKind
): Promise<RunRow> {
	const credential = await createRunSessionCredential({
		bridgeTokenStore: services.stores.bridgeToken,
	})({ agentKind: task.agentKind, taskId: task.id, userId: task.userId });
	const runId = crypto.randomUUID();
	return await services.stores.run.insert({
		agentKind: task.agentKind,
		branch: null,
		computerId: task.computerId,
		id: runId,
		issueSnapshots: [],
		launchKey: runId,
		sessionTokenId: credential.tokenId,
		taskId: task.id,
		workspaceKind,
	});
}

/** §8.5 step 10: best-effort WS push. A failure never rolls the Start back —
 * the run is already queued, and heartbeat pendingCommands delivers it within
 * one interval (D4 fallback). */
async function notifyComputerBestEffort(
	services: Services,
	computerId: string
): Promise<void> {
	try {
		await services.computerControl.notifyComputer(computerId);
	} catch {
		// Swallowed on purpose: the heartbeat fallback is the delivery guarantee.
	}
}

const create = authorizedUserProcedure
	.input(
		z.object({
			agentKind: z.enum(AGENT_KINDS),
			computerId: z.uuid(),
			// Stored verbatim (§6.9) — validated for substance, never trimmed.
			description: z
				.string()
				.refine(hasVisibleText, "Task description is required"),
			name: z
				.string()
				.max(TASK_NAME_MAX_LENGTH)
				.refine(hasVisibleText, "Task name is required"),
		})
	)
	.handler(async ({ input, context }) => {
		const { services } = context;
		const computer = await requireOnlineOwnedComputer(
			services,
			context.authedUser.id,
			input.computerId
		);
		requireRuntimeInInventory(computer, input.agentKind);
		// §8.5 steps 4–8: assemble the opening message once (workspaceKind is
		// always standalone until S4 lands GitHub context), then task + run.
		const openingMessage = assembleOpeningMessage({
			agentKind: input.agentKind,
			computerName: computer.name,
			description: input.description,
			workspaceKind: "standalone",
		});
		const task = await services.stores.task.insert({
			agentKind: input.agentKind,
			computerId: computer.id,
			description: input.description,
			name: input.name,
			openingMessage,
			repositoryFullName: null,
			repositoryUrl: null,
			userId: context.authedUser.id,
		});
		const run = await appendRun(services, task, "standalone");
		await notifyComputerBestEffort(services, computer.id);
		return { runId: run.id, taskId: task.id };
	});

/** List projection of a Task's latest Run — enough for status badges. */
function toLatestRun(run: RunRow | null) {
	if (!run) {
		return null;
	}
	return {
		createdAt: run.createdAt,
		errorMessage: run.errorMessage,
		id: run.id,
		status: run.status,
	};
}

const list = authorizedUserProcedure.handler(async ({ context }) => {
	const rows = await context.services.stores.task.listByUser(
		context.authedUser.id
	);
	return await Promise.all(
		rows.map(async (task) => ({
			agentKind: task.agentKind,
			computerId: task.computerId,
			createdAt: task.createdAt,
			id: task.id,
			latestRun: toLatestRun(
				await context.services.stores.run.latestByTask(task.id)
			),
			name: task.name,
			status: task.status,
		}))
	);
});

// Explicit field list so the internal credential linkage (sessionTokenId) and
// launchKey can never leak into the user-facing response by accident.
function toTaskRun(run: RunRow) {
	return {
		agentKind: run.agentKind,
		branch: run.branch,
		createdAt: run.createdAt,
		errorMessage: run.errorMessage,
		id: run.id,
		sessionId: run.sessionId,
		status: run.status,
		updatedAt: run.updatedAt,
		workspaceKind: run.workspaceKind,
		workspacePath: run.workspacePath,
	};
}

const get = authorizedUserProcedure
	.input(z.object({ taskId: z.uuid() }))
	.handler(async ({ input, context }) => {
		const task = await context.services.stores.task.getById(
			input.taskId,
			context.authedUser.id
		);
		if (!task) {
			throw new ORPCError("NOT_FOUND", { message: "Task not found" });
		}
		const [runs, computer] = await Promise.all([
			context.services.stores.run.listByTask(task.id),
			context.services.stores.computer.getById(task.computerId),
		]);
		return {
			computerName: computer?.name ?? null,
			runs: runs.map(toTaskRun),
			task,
		};
	});

const retry = authorizedUserProcedure
	.input(z.object({ taskId: z.uuid() }))
	.handler(async ({ input, context }) => {
		const { services } = context;
		const task = await services.stores.task.getById(
			input.taskId,
			context.authedUser.id
		);
		if (!task) {
			throw new ORPCError("NOT_FOUND", { message: "Task not found" });
		}
		const latest = await services.stores.run.latestByTask(task.id);
		if (!(latest && RETRYABLE_STATUSES.has(latest.status))) {
			throw new ORPCError("PRECONDITION_FAILED", {
				message: "Only a failed or stopped run can be retried",
			});
		}
		await requireOnlineOwnedComputer(
			services,
			context.authedUser.id,
			task.computerId
		);
		const run = await appendRun(services, task, latest.workspaceKind);
		await notifyComputerBestEffort(services, task.computerId);
		return { runId: run.id };
	});

export const tasksRouter = {
	create,
	get,
	list,
	retry,
};
