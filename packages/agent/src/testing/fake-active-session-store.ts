import type { BridgeSessionStore } from "../bridge-session-ports";
import type { ComputerStore } from "../computer-ports";
import type { ProjectStore } from "../project-ports";
import type {
	ActiveSessionRow,
	ActiveSessionStore,
} from "../task/active-session-ports";
import {
	type RunStore,
	type TaskStore,
	TERMINAL_RUN_STATUSES,
} from "../task/task-ports";

// In-memory ActiveSessionStore for router-level tests: composes the join the
// real store (packages/db/src/repositories/active-session-store.ts, which has
// PGlite coverage) does in ONE statement out of the other fakes. Reading
// per-task here is fine — a fake only has to behave correctly, and the
// no-N+1 requirement is a property of the SQL, not of the port.

export interface FakeActiveSessionDeps {
	bridgeSession: BridgeSessionStore;
	computer: ComputerStore;
	project: ProjectStore;
	run: RunStore;
	task: TaskStore;
}

type TaskRow = Awaited<ReturnType<TaskStore["listByUser"]>>[number];
type RunRow = NonNullable<Awaited<ReturnType<RunStore["latestByTask"]>>>;

/** The bridge-session left join: null columns both when the run never bound a
 * session and when the bound row is gone — the same thing to the reconcile. */
async function joinSession(deps: FakeActiveSessionDeps, run: RunRow) {
	const session = run.sessionId
		? await deps.bridgeSession.get(run.sessionId)
		: null;
	if (!session) {
		return { sessionLastSeenAt: null, sessionStatus: null };
	}
	return {
		sessionLastSeenAt: session.lastSeenAt,
		sessionStatus: session.status,
	};
}

/** The computer (inner) and project (left) joins. A missing computer would
 * drop the record entirely in the real query; the epoch date preserves the
 * reconcile's "presumed dead" verdict without a nullable column here. */
async function joinComputerAndProject(
	deps: FakeActiveSessionDeps,
	userId: string,
	task: TaskRow,
	run: RunRow
) {
	const computer = await deps.computer.getById(run.computerId);
	const project = task.projectId
		? await deps.project.getById(task.projectId, userId)
		: null;
	return {
		computerLastSeenAt: computer ? computer.lastSeenAt : new Date(0),
		computerName: computer ? computer.name : "",
		projectName: project ? project.name : null,
	};
}

export function createFakeActiveSessionStore(
	deps: FakeActiveSessionDeps
): ActiveSessionStore {
	async function toRow(
		userId: string,
		task: TaskRow
	): Promise<ActiveSessionRow | null> {
		const run = await deps.run.latestByTask(task.id);
		if (!run || TERMINAL_RUN_STATUSES.has(run.status)) {
			return null;
		}
		return {
			...(await joinComputerAndProject(deps, userId, task, run)),
			...(await joinSession(deps, run)),
			agentKind: run.agentKind,
			computerId: run.computerId,
			projectId: task.projectId,
			runId: run.id,
			runStatus: run.status,
			sessionId: run.sessionId,
			taskId: task.id,
			taskName: task.name,
			updatedAt: run.updatedAt,
		};
	}

	return {
		async listActiveByUser(userId) {
			const tasks = await deps.task.listByUser(userId);
			const rows = await Promise.all(tasks.map((task) => toRow(userId, task)));
			return rows.filter((row): row is ActiveSessionRow => row !== null);
		},
	};
}
