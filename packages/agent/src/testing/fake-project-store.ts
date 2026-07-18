import type { ProjectRow, ProjectStore } from "../project-ports";

// In-memory ProjectStore fake for router-level tests (Q1) — mirrors
// fake-task-stores.ts. The real DB-backed store
// (packages/db/src/repositories/project-store.ts) has PGlite integration
// coverage; this only needs to behave correctly, not persist anything.

function makeFakeProjectReads(
	map: Map<string, ProjectRow>
): Pick<
	ProjectStore,
	"getById" | "getByIdForComputer" | "listByComputer" | "listCreatedByComputer"
> {
	return {
		getById(id, userId) {
			const row = map.get(id);
			return Promise.resolve(row && row.userId === userId ? row : null);
		},
		getByIdForComputer(id, computerId) {
			const row = map.get(id);
			return Promise.resolve(row && row.computerId === computerId ? row : null);
		},
		listByComputer(userId, computerId) {
			return Promise.resolve(
				[...map.values()]
					.filter(
						(row) => row.userId === userId && row.computerId === computerId
					)
					.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
			);
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

export function createFakeProjectStore(
	map: Map<string, ProjectRow> = new Map()
): ProjectStore & { rows: Map<string, ProjectRow> } {
	return {
		rows: map,
		...makeFakeProjectReads(map),
		insert(input) {
			const now = new Date();
			const row: ProjectRow = {
				...input,
				id: crypto.randomUUID(),
				status: "created",
				errorMessage: null,
				localPath: null,
				createdAt: now,
				updatedAt: now,
			};
			map.set(row.id, row);
			return Promise.resolve(row);
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
		delete(id, userId) {
			const row = map.get(id);
			if (!row || row.userId !== userId) {
				return Promise.resolve(false);
			}
			map.delete(id);
			return Promise.resolve(true);
		},
	};
}
