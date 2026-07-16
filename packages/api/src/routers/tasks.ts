import { assembleOpeningMessage } from "@better-agent/agent/task/opening-message";
import { createRunSessionCredential } from "@better-agent/agent/task/run-session-credential";
import type {
	IssueSnapshot,
	RunRow,
	TaskRow,
	WorkspaceKind,
} from "@better-agent/agent/task-ports";
import { ORPCError } from "@orpc/server";
import { z } from "zod";
import type { Context } from "../context";
import { authorizedUserProcedure } from "../index";
import {
	refreshedIssueSnapshots,
	repositoryTaskFields,
	resolveGithubStartContext,
} from "./tasks-github-context";
import {
	notifyComputerBestEffort,
	requireOnlineOwnedComputer,
	requireRuntimeInInventory,
} from "./tasks-guards";

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

/** Appends the Task's next sequential Run: fresh session credential, fresh
 * pre-generated id so launchKey === run id (the D4 idempotency key), and the
 * issue snapshots fetched for THIS launch — snapshots belong to the Run
 * (§6.15), so every caller passes the ones it just resolved. */
async function appendRun(
	services: Services,
	task: TaskRow,
	workspaceKind: WorkspaceKind,
	issueSnapshots: IssueSnapshot[]
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
		issueSnapshots,
		launchKey: runId,
		sessionTokenId: credential.tokenId,
		taskId: task.id,
		workspaceKind,
	});
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
			// Linked issues, in the user's order (§6.15) — only valid alongside
			// a repository; the handler enforces that pairing.
			issueNumbers: z.array(z.number().int().min(1)).optional(),
			name: z
				.string()
				.max(TASK_NAME_MAX_LENGTH)
				.refine(hasVisibleText, "Task name is required"),
			// Optional GitHub repository (§6.14), as `owner/repo`.
			repositoryFullName: z.string().min(1).optional(),
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
		// §8.5 steps 4–5: GitHub validation + snapshots, still BEFORE any write.
		const { issueSnapshots, repository } = await resolveGithubStartContext(
			services,
			context.authedUser.id,
			input
		);
		const workspaceKind: WorkspaceKind = repository
			? "repository"
			: "standalone";
		// §8.5 steps 6–8: assemble the opening message once, then task + run.
		const openingMessage = assembleOpeningMessage({
			agentKind: input.agentKind,
			computerName: computer.name,
			description: input.description,
			issues: issueSnapshots,
			repositoryUrl: repository?.url,
			workspaceKind,
		});
		const task = await services.stores.task.insert({
			agentKind: input.agentKind,
			computerId: computer.id,
			description: input.description,
			name: input.name,
			openingMessage,
			...repositoryTaskFields(repository),
			userId: context.authedUser.id,
		});
		const run = await appendRun(services, task, workspaceKind, issueSnapshots);
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

/** S3-T2: the run projection plus its bound bridge session row (null until
 * the client binds one at startSession) — the Conversation page renders the
 * run's message stream straight off this session. */
async function toTaskRunWithSession(services: Services, run: RunRow) {
	const session = run.sessionId
		? await services.stores.bridgeSession.get(run.sessionId)
		: null;
	return { ...toTaskRun(run), session };
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
			runs: await Promise.all(
				runs.map((run) => toTaskRunWithSession(context.services, run))
			),
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
		// Snapshots belong to the Run: the new Run launches with the freshest
		// obtainable issue state, falling back per-issue to the last snapshot.
		const issueSnapshots = await refreshedIssueSnapshots(
			services,
			task,
			latest.issueSnapshots
		);
		const run = await appendRun(
			services,
			task,
			latest.workspaceKind,
			issueSnapshots
		);
		await notifyComputerBestEffort(services, task.computerId);
		return { runId: run.id };
	});

export const tasksRouter = {
	create,
	get,
	list,
	retry,
};
