import type {
	ComputerRow,
	ComputerStore,
} from "@better-agent/agent/computer-ports";
import {
	createReplayGuard,
	signComputerRequest,
} from "@better-agent/agent/crypto/computer-signature";
import type { BridgeMessageRow } from "@better-agent/agent/ports";
import {
	createFakeRunStore,
	createFakeTaskStore,
} from "@better-agent/agent/testing/fake-task-stores";
import { createRouterClient } from "@orpc/server";
import { createComputerControlChannel } from "../computers/control-channel";
import type { AuthedBridgeToken, ComputerAuthHeaders } from "../context";
import {
	memoryBridgeMessageStore,
	memoryBridgeSessionStore,
	memoryBridgeTokenStore,
} from "./bridge-test-helpers-stores";
import { appRouter } from "./index";

// Shared fixtures for the computers router tests — in-memory ComputerStore +
// replay guard wired into a minimal services object, plus the three client
// flavors the router serves: public (pair), user-plane (createPairingCode/
// list/delete) and computer-plane (signed register/heartbeat).

export const ALICE = {
	id: "alice-uid",
	email: "alice@x.com",
	createdAt: new Date(),
	blocked: false,
};

export const BOB = {
	...ALICE,
	id: "bob-uid",
	email: "bob@x.com",
};

interface PairingCodeRow {
	codeHash: string;
	expiresAt: Date;
	usedAt: Date | null;
	userId: string;
}

function memoryPairingCodes(
	codes: PairingCodeRow[]
): Pick<ComputerStore, "createPairingCode" | "consumePairingCode"> {
	return {
		createPairingCode({ userId, codeHash, expiresAt }) {
			codes.push({ userId, codeHash, expiresAt, usedAt: null });
			return Promise.resolve();
		},
		consumePairingCode(codeHash, now) {
			const row = codes.find(
				(code) =>
					code.codeHash === codeHash &&
					code.usedAt === null &&
					code.expiresAt > now
			);
			if (!row) {
				return Promise.resolve(null);
			}
			row.usedAt = now;
			return Promise.resolve({ userId: row.userId });
		},
	};
}

function memoryComputerRows(
	rows: Map<string, ComputerRow>
): Omit<ComputerStore, "createPairingCode" | "consumePairingCode"> {
	return {
		insert(input) {
			const now = new Date();
			const row: ComputerRow = {
				...input,
				id: crypto.randomUUID(),
				createdAt: now,
				updatedAt: now,
				lastSeenAt: now,
			};
			rows.set(row.id, row);
			return Promise.resolve(row);
		},
		updateInventory(id, update) {
			const row = rows.get(id);
			if (!row) {
				return Promise.resolve(false);
			}
			rows.set(id, { ...row, ...update, updatedAt: new Date() });
			return Promise.resolve(true);
		},
		touch(id, lastSeenAt) {
			const row = rows.get(id);
			if (!row) {
				return Promise.resolve(false);
			}
			rows.set(id, { ...row, lastSeenAt });
			return Promise.resolve(true);
		},
		listByUser(userId) {
			return Promise.resolve(
				[...rows.values()].filter((row) => row.userId === userId)
			);
		},
		getById(id) {
			return Promise.resolve(rows.get(id) ?? null);
		},
		deleteById(id, userId) {
			const row = rows.get(id);
			if (!row || row.userId !== userId) {
				return Promise.resolve(false);
			}
			rows.delete(id);
			return Promise.resolve(true);
		},
	};
}

/** A signed computer-auth header triple for one request; pass an explicit
 * timestamp to exercise the window/replay paths deterministically. */
export function signedAuth(
	computerId: string,
	privateKeyPem: string,
	timestampMs: number = Date.now()
): ComputerAuthHeaders {
	return {
		computerId,
		signature: signComputerRequest(privateKeyPem, computerId, timestampMs),
		timestampMs,
	};
}

function buildRigServices() {
	const rows = new Map<string, ComputerRow>();
	const computer: ComputerStore = {
		...memoryPairingCodes([]),
		...memoryComputerRows(rows),
	};
	// S2-T2/S2-T3: the launch-delivery stores heartbeat/ackLaunch/tasks.create
	// read alongside the computer store — empty by default.
	const run = createFakeRunStore();
	const task = createFakeTaskStore();
	const bridgeToken = memoryBridgeTokenStore(
		new Map(),
		new Map(),
		() => undefined
	);
	// Recorded so tests can assert that Task Start never writes lifecycle chat
	// messages (§19.2) — the map must stay empty through the whole flow.
	const bridgeMessages = new Map<string, BridgeMessageRow[]>();
	// S25-T2: lets the cross-layer flow tests drive bridge.startSession(runId)
	// with the launch payload's sessionCredential inside the SAME rig.
	const bridgeSession = memoryBridgeSessionStore(new Map());
	const services = {
		authz: { enabled: false },
		// Real channel, no registered sockets: notifyComputer is a push no-op and
		// delivery falls back to heartbeat pendingCommands, exactly like a no-WS
		// production computer (D4).
		computerControl: createComputerControlChannel({
			bridgeToken,
			computer,
			run,
			task,
		}),
		computerReplayGuard: createReplayGuard(),
		stores: {
			bridgeMessage: memoryBridgeMessageStore(bridgeMessages),
			bridgeSession,
			bridgeToken,
			computer,
			run,
			task,
		},
	} as never;
	return {
		bridgeMessages,
		bridgeSession,
		bridgeToken,
		computer,
		rows,
		run,
		services,
		task,
	};
}

export function buildComputerRig() {
	const { services, ...stores } = buildRigServices();
	const base = {
		services,
		authedAgent: null,
		authedBridgeToken: null,
		authedUser: null,
		clientIp: "127.0.0.1",
		computerAuth: null,
		userAgent: null,
		waitUntil: (p: Promise<unknown>) => {
			p.catch(() => undefined);
		},
	};
	const publicClient = createRouterClient(appRouter, { context: base });
	const userClientFor = (user: typeof ALICE) =>
		createRouterClient(appRouter, { context: { ...base, authedUser: user } });
	const computerClientFor = (auth: ComputerAuthHeaders) =>
		createRouterClient(appRouter, { context: { ...base, computerAuth: auth } });
	// S25-T2: the CLI plane — a bridge-token client for the run's pre-issued
	// session credential, so flow tests can close the chain at startSession.
	const bridgeClientFor = (bridgeAuth: AuthedBridgeToken) =>
		createRouterClient(appRouter, {
			context: { ...base, authedBridgeToken: bridgeAuth },
		});
	return {
		...stores,
		bridgeClientFor,
		computerClientFor,
		publicClient,
		userClientFor,
	};
}
