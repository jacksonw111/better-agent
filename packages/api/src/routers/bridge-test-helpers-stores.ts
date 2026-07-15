import type {
	BridgeMessageRow,
	BridgeMessageStore,
	BridgeSessionRow,
	BridgeSessionStore,
	BridgeTokenRow,
	BridgeTokenStore,
} from "@better-agent/agent/ports";

// In-memory bridgeToken/bridgeSession/bridgeMessage store fakes for the
// bridge router tests — split out of bridge-test-helpers.ts to keep that
// file under the per-file line cap (mirrors bridge-test-helpers-mcp.ts's
// split for the mcpServer store fake).

type CreateTokenInput = Parameters<BridgeTokenStore["create"]>[0];

function newTokenRow(input: CreateTokenInput): BridgeTokenRow {
	return {
		id: crypto.randomUUID(),
		userId: input.userId,
		name: input.name ?? null,
		agentKind: input.agentKind,
		token: input.token,
		last4: input.last4 ?? null,
		config: input.config ?? null,
		createdAt: new Date(),
		revokedAt: null,
	};
}

export function cascadeDeleteSessions(
	sessionRows: Map<string, BridgeSessionRow>,
	messageRowsBySession: Map<string, BridgeMessageRow[]>,
	tokenId: string
): void {
	for (const [sessionId, session] of sessionRows) {
		if (session.tokenId === tokenId) {
			sessionRows.delete(sessionId);
			messageRowsBySession.delete(sessionId);
		}
	}
}

/** In-memory updateConfig, split out so `memoryBridgeTokenStore` stays under
 * the max-lines-per-function gate. */
function memoryUpdateConfig(
	rows: Map<string, BridgeTokenRow>,
	id: string,
	userId: string,
	config: BridgeTokenRow["config"]
): Promise<BridgeTokenRow | null> {
	const row = rows.get(id);
	if (!row || row.userId !== userId) {
		return Promise.resolve(null);
	}
	const updated: BridgeTokenRow = { ...row, config };
	rows.set(id, updated);
	return Promise.resolve(updated);
}

export function memoryBridgeTokenStore(
	rows: Map<string, BridgeTokenRow>,
	hashes: Map<string, string>,
	onDeleteAgent: (tokenId: string) => void
): BridgeTokenStore {
	return {
		create(input) {
			const row = newTokenRow(input);
			rows.set(row.id, row);
			hashes.set(row.id, input.tokenHash);
			return Promise.resolve(row);
		},
		listByUser(userId) {
			return Promise.resolve(
				[...rows.values()].filter((row) => row.userId === userId)
			);
		},
		getById(id, userId) {
			const row = rows.get(id);
			return Promise.resolve(row && row.userId === userId ? row : null);
		},
		findByHash(tokenHash) {
			const found = [...hashes.entries()].find(
				([, hash]) => hash === tokenHash
			);
			const row = found && rows.get(found[0]);
			return Promise.resolve(
				row
					? { id: row.id, userId: row.userId, revokedAt: row.revokedAt }
					: null
			);
		},
		deleteAgent(id, userId) {
			const row = rows.get(id);
			if (row && row.userId === userId) {
				rows.delete(id);
				hashes.delete(id);
				onDeleteAgent(id);
			}
			return Promise.resolve();
		},
		updateConfig: (id, userId, config) =>
			memoryUpdateConfig(rows, id, userId, config),
	};
}

function newSessionRow(
	input: Parameters<BridgeSessionStore["create"]>[0]
): BridgeSessionRow {
	return {
		id: crypto.randomUUID(),
		userId: input.userId,
		tokenId: input.tokenId,
		agentKind: input.agentKind,
		label: input.label ?? null,
		name: null,
		agentSessionId: null,
		status: "active",
		createdAt: new Date(),
		lastSeenAt: new Date(),
		archivedAt: null,
		starred: false,
		vncEndpoint: null,
	};
}

/** The owner-guarded in-memory mutators (end + the P3-T1
 * rename/star/archive/hard-delete), matching the real store's guard — split
 * out so `memoryBridgeSessionStore` stays under the max-lines-per-function
 * gate (same precedent as memoryListSessionPage). */
function memorySessionMutators(
	rows: Map<string, BridgeSessionRow>
): Pick<
	BridgeSessionStore,
	"deleteHard" | "end" | "rename" | "setArchived" | "setStarred"
> {
	const patchOwned = (
		id: string,
		userId: string,
		patch: Partial<BridgeSessionRow>
	) => {
		const row = rows.get(id);
		if (row && row.userId === userId) {
			rows.set(id, { ...row, ...patch });
		}
		return Promise.resolve();
	};
	return {
		end: (id, userId) => patchOwned(id, userId, { status: "ended" }),
		rename: (id, userId, name) => patchOwned(id, userId, { name }),
		setArchived: (id, userId, archived) =>
			patchOwned(id, userId, { archivedAt: archived ? new Date() : null }),
		setStarred: (id, userId, starred) => patchOwned(id, userId, { starred }),
		deleteHard(id, userId) {
			const row = rows.get(id);
			if (row && row.userId === userId) {
				rows.delete(id);
			}
			return Promise.resolve();
		},
	};
}

/** Mirrors the real store's newest-first keyset page (createdAt DESC, id DESC,
 * `before` = strictly-after-cursor) — split out so `memoryBridgeSessionStore`
 * stays under the max-lines-per-function gate. */
function memoryListSessionPage(
	rows: Map<string, BridgeSessionRow>,
	userId: string,
	opts: Parameters<BridgeSessionStore["listPageByUser"]>[1]
): BridgeSessionRow[] {
	const { before } = opts;
	return [...rows.values()]
		.filter((row) => row.userId === userId)
		.filter((row) =>
			opts.archived ? row.archivedAt !== null : row.archivedAt === null
		)
		.filter((row) => !opts.tokenId || row.tokenId === opts.tokenId)
		.filter((row) => {
			if (!before) {
				return true;
			}
			const rowMs = row.createdAt.getTime();
			const cursorMs = before.createdAt.getTime();
			return rowMs < cursorMs || (rowMs === cursorMs && row.id < before.id);
		})
		.sort(
			(a, b) =>
				b.createdAt.getTime() - a.createdAt.getTime() ||
				b.id.localeCompare(a.id)
		)
		.slice(0, opts.limit);
}

export function memoryBridgeSessionStore(
	rows: Map<string, BridgeSessionRow>
): BridgeSessionStore {
	return {
		create(input) {
			const row = newSessionRow(input);
			rows.set(row.id, row);
			return Promise.resolve(row);
		},
		get(id) {
			return Promise.resolve(rows.get(id) ?? null);
		},
		listByUser(userId) {
			return Promise.resolve(
				[...rows.values()].filter((row) => row.userId === userId)
			);
		},
		listPageByUser(userId, opts) {
			return Promise.resolve(memoryListSessionPage(rows, userId, opts));
		},
		touch(id) {
			const row = rows.get(id);
			if (row) {
				rows.set(id, { ...row, lastSeenAt: new Date() });
			}
			return Promise.resolve();
		},
		setAgentSessionId(id, agentSessionId) {
			const row = rows.get(id);
			if (row) {
				rows.set(id, { ...row, agentSessionId });
			}
			return Promise.resolve();
		},
		setVncEndpoint(id, vncEndpoint) {
			const row = rows.get(id);
			if (row) {
				rows.set(id, { ...row, vncEndpoint });
			}
			return Promise.resolve();
		},
		...memorySessionMutators(rows),
	};
}

export function memoryBridgeMessageStore(
	rowsBySession: Map<string, BridgeMessageRow[]>
): BridgeMessageStore {
	return {
		append(sessionId, seq, event) {
			const rows = rowsBySession.get(sessionId) ?? [];
			rows.push({ seq, event });
			rowsBySession.set(sessionId, rows);
			return Promise.resolve();
		},
		appendMany(sessionId, newRows) {
			const rows = rowsBySession.get(sessionId) ?? [];
			rows.push(...newRows);
			rowsBySession.set(sessionId, rows);
			return Promise.resolve();
		},
		list(sessionId, afterSeq, limit) {
			const rows = rowsBySession.get(sessionId) ?? [];
			return Promise.resolve(
				rows
					.filter((row) => row.seq > afterSeq)
					.sort((a, b) => a.seq - b.seq)
					.slice(0, limit)
			);
		},
		listTail(sessionId, limit) {
			const rows = rowsBySession.get(sessionId) ?? [];
			return Promise.resolve(
				[...rows].sort((a, b) => a.seq - b.seq).slice(-limit)
			);
		},
	};
}
