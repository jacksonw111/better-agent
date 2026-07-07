import { createInMemoryRelayStore } from "@better-agent/agent/bridge/relay-store";
import type {
	BridgeAgentKind,
	BridgeMessageRow,
	BridgeMessageStore,
	BridgeSessionRow,
	BridgeSessionStore,
	BridgeTokenRow,
	BridgeTokenStore,
} from "@better-agent/agent/ports";
import { createRouterClient } from "@orpc/server";
import type { AuthedBridgeToken } from "../context";
import { appRouter } from "./index";

// Shared fixtures for the bridge router tests (bridge.test.ts and
// bridge-limits.test.ts), kept in one place so both stay under the
// per-file line cap without duplicating the in-memory store wiring.

export function fakeHonoRequest(authHeader?: string) {
	const header = (name: string) =>
		name.toLowerCase() === "authorization" ? authHeader : undefined;
	return { req: { header } } as never;
}

export const ALICE = {
	id: "alice-uid",
	email: "alice@x.com",
	createdAt: new Date(),
	blocked: false,
};
export const BOB = {
	id: "bob-uid",
	email: "bob@x.com",
	createdAt: new Date(),
	blocked: false,
};
export const AGENT_KIND: BridgeAgentKind = "claude-code";

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

function cascadeDeleteSessions(
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

function memoryBridgeTokenStore(
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

function memoryBridgeSessionStore(
	rows: Map<string, BridgeSessionRow>
): BridgeSessionStore {
	return {
		create({ userId, tokenId, agentKind, label }) {
			const row: BridgeSessionRow = {
				id: crypto.randomUUID(),
				userId,
				tokenId,
				agentKind,
				label: label ?? null,
				agentSessionId: null,
				status: "active",
				createdAt: new Date(),
				lastSeenAt: new Date(),
			};
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
		touch(id) {
			const row = rows.get(id);
			if (row) {
				rows.set(id, { ...row, lastSeenAt: new Date() });
			}
			return Promise.resolve();
		},
		end(id, userId) {
			const row = rows.get(id);
			if (row && row.userId === userId) {
				rows.set(id, { ...row, status: "ended" });
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
	};
}

function memoryBridgeMessageStore(
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
	};
}

export function build() {
	const tokenRows = new Map<string, BridgeTokenRow>();
	const tokenHashes = new Map<string, string>();
	const sessionRows = new Map<string, BridgeSessionRow>();
	const messageRowsBySession = new Map<string, BridgeMessageRow[]>();
	const bridgeSession = memoryBridgeSessionStore(sessionRows);
	const bridgeMessage = memoryBridgeMessageStore(messageRowsBySession);
	const bridgeToken = memoryBridgeTokenStore(
		tokenRows,
		tokenHashes,
		(tokenId) =>
			cascadeDeleteSessions(sessionRows, messageRowsBySession, tokenId)
	);
	const relayStore = createInMemoryRelayStore();
	const services = {
		relayStore,
		stores: { bridgeToken, bridgeSession, bridgeMessage },
	};
	const userClientFor = (user: typeof ALICE) =>
		createRouterClient(appRouter, {
			context: {
				services: services as never,
				authedAgent: null,
				authedUser: user,
				clientIp: "127.0.0.1",
				userAgent: null,
			},
		});
	const bridgeClientFor = (bridgeAuth: AuthedBridgeToken) =>
		createRouterClient(appRouter, {
			context: {
				services: services as never,
				authedAgent: null,
				authedUser: null,
				authedBridgeToken: bridgeAuth,
				clientIp: "127.0.0.1",
				userAgent: null,
			},
		});
	return {
		bridgeToken,
		bridgeSession,
		bridgeMessage,
		services,
		userClientFor,
		bridgeClientFor,
	};
}
