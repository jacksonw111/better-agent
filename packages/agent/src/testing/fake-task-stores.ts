import type { RunRow, RunStore, TaskRow, TaskStore } from "../task/task-ports";

// In-memory TaskStore + RunStore fakes for router-level tests (S2-T2) —
// mirrors fake-skill-store.ts's shape. The real DB-backed stores
// (packages/db/src/repositories/{task,run}-store.ts) have PGlite integration
// coverage; these only need to behave correctly, not persist anything.

export function createFakeTaskStore(
	map: Map<string, TaskRow> = new Map()
): TaskStore & { rows: Map<string, TaskRow> } {
	return {
		rows: map,
		insert(input) {
			const now = new Date();
			const task: TaskRow = {
				...input,
				id: crypto.randomUUID(),
				status: "active",
				createdAt: now,
				updatedAt: now,
			};
			map.set(task.id, task);
			return Promise.resolve(task);
		},
		getById(id, userId) {
			const row = map.get(id);
			return Promise.resolve(row && row.userId === userId ? row : null);
		},
		listByUser(userId) {
			return Promise.resolve(
				[...map.values()]
					.filter((row) => row.userId === userId)
					.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
			);
		},
		updateStatus(id, userId, status) {
			const row = map.get(id);
			if (!row || row.userId !== userId) {
				return Promise.resolve(false);
			}
			map.set(id, { ...row, status, updatedAt: new Date() });
			return Promise.resolve(true);
		},
	};
}

function makeFakeRunReads(
	map: Map<string, RunRow>
): Pick<
	RunStore,
	| "getById"
	| "getByIdForComputer"
	| "getByLaunchKey"
	| "latestByTask"
	| "listByTask"
	| "listCreatedByComputer"
> {
	const byTask = (taskId: string) =>
		[...map.values()]
			.filter((row) => row.taskId === taskId)
			.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
	return {
		getById(id) {
			return Promise.resolve(map.get(id) ?? null);
		},
		getByIdForComputer(id, computerId) {
			const row = map.get(id);
			return Promise.resolve(row && row.computerId === computerId ? row : null);
		},
		getByLaunchKey(launchKey) {
			return Promise.resolve(
				[...map.values()].find((row) => row.launchKey === launchKey) ?? null
			);
		},
		listByTask(taskId) {
			return Promise.resolve(byTask(taskId));
		},
		latestByTask(taskId) {
			return Promise.resolve(byTask(taskId).at(-1) ?? null);
		},
		listCreatedByComputer(computerId) {
			return Promise.resolve(
				[...map.values()]
					.filter(
						(row) => row.computerId === computerId && row.status === "created"
					)
					.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
			);
		},
	};
}

export function createFakeRunStore(
	map: Map<string, RunRow> = new Map()
): RunStore & { rows: Map<string, RunRow> } {
	return {
		rows: map,
		...makeFakeRunReads(map),
		insert(input) {
			if ([...map.values()].some((row) => row.launchKey === input.launchKey)) {
				return Promise.reject(new Error("duplicate launchKey"));
			}
			const now = new Date();
			const run: RunRow = {
				...input,
				id: crypto.randomUUID(),
				status: "created",
				sessionId: null,
				sessionTokenId: input.sessionTokenId ?? null,
				workspacePath: null,
				errorMessage: null,
				createdAt: now,
				updatedAt: now,
			};
			map.set(run.id, run);
			return Promise.resolve(run);
		},
		updateStatus(id, update) {
			const row = map.get(id);
			if (!row) {
				return Promise.resolve(false);
			}
			const patch = Object.fromEntries(
				Object.entries(update).filter(([, value]) => value !== undefined)
			);
			map.set(id, { ...row, ...patch, updatedAt: new Date() });
			return Promise.resolve(true);
		},
	};
}
