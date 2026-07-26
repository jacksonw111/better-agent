import type { PtySessionRow, PtySessionStore } from "../pty-session-ports";

// In-memory PtySessionStore fake for router-level tests (P25-A) — mirrors
// fake-project-store.ts. The real DB-backed store
// (packages/db/src/repositories/pty-session-store.ts) has PGlite integration
// coverage; this only needs to behave correctly, not persist anything.

const DEFAULT_STALE_GRACE_MS = 30_000;

type Rows = Map<string, PtySessionRow>;

function activeByActivity(
	rows: Rows,
	predicate: (row: PtySessionRow) => boolean
): PtySessionRow[] {
	return [...rows.values()]
		.filter((row) => row.status === "active" && predicate(row))
		.sort((a, b) => b.lastActivityAt.getTime() - a.lastActivityAt.getTime());
}

function makeReads(
	rows: Rows
): Pick<
	PtySessionStore,
	"getById" | "listActiveByComputer" | "listActiveByUser"
> {
	return {
		getById(id, userId) {
			const row = rows.get(id);
			return Promise.resolve(row && row.userId === userId ? row : null);
		},
		listActiveByComputer(userId, computerId, projectId) {
			return Promise.resolve(
				activeByActivity(
					rows,
					(row) =>
						row.userId === userId &&
						row.computerId === computerId &&
						(projectId === undefined || row.projectId === projectId)
				)
			);
		},
		listActiveByUser(userId) {
			return Promise.resolve(
				activeByActivity(rows, (row) => row.userId === userId)
			);
		},
	};
}

function makeMutations(
	rows: Rows
): Pick<PtySessionStore, "create" | "markEnded" | "rename"> {
	return {
		create(input) {
			const now = new Date();
			const row: PtySessionRow = {
				id: crypto.randomUUID(),
				userId: input.userId,
				computerId: input.computerId,
				projectId: input.projectId,
				agentKind: input.agentKind,
				title: input.title,
				status: "active",
				createdAt: now,
				lastActivityAt: now,
			};
			rows.set(row.id, row);
			return Promise.resolve(row);
		},
		markEnded(id, userId) {
			const row = rows.get(id);
			if (!row || row.userId !== userId) {
				return Promise.resolve(null);
			}
			const ended: PtySessionRow = { ...row, status: "ended" };
			rows.set(id, ended);
			return Promise.resolve(ended);
		},
		rename(id, userId, title) {
			const row = rows.get(id);
			if (!row || row.userId !== userId) {
				return Promise.resolve(null);
			}
			const renamed: PtySessionRow = { ...row, title };
			rows.set(id, renamed);
			return Promise.resolve(renamed);
		},
	};
}

function makeReconcile(
	rows: Rows
): Pick<PtySessionStore, "touchActivity" | "endStaleExcept"> {
	return {
		touchActivity(computerId, id) {
			const row = rows.get(id);
			if (row && row.computerId === computerId) {
				rows.set(id, { ...row, lastActivityAt: new Date() });
			}
			return Promise.resolve();
		},
		endStaleExcept(computerId, aliveSessionIds, graceMs) {
			const cutoff = Date.now() - (graceMs ?? DEFAULT_STALE_GRACE_MS);
			for (const row of rows.values()) {
				if (
					row.computerId === computerId &&
					row.status === "active" &&
					row.createdAt.getTime() < cutoff &&
					!aliveSessionIds.includes(row.id)
				) {
					rows.set(row.id, { ...row, status: "ended" });
				}
			}
			return Promise.resolve();
		},
	};
}

export function createFakePtySessionStore(): PtySessionStore {
	const rows: Rows = new Map();
	return {
		...makeReads(rows),
		...makeMutations(rows),
		...makeReconcile(rows),
	};
}
