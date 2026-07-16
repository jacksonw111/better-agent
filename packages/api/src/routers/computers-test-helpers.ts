import type {
	ComputerRow,
	ComputerStore,
} from "@better-agent/agent/computer-ports";
import {
	createReplayGuard,
	signComputerRequest,
} from "@better-agent/agent/crypto/computer-signature";
import {
	createFakeRunStore,
	createFakeTaskStore,
} from "@better-agent/agent/testing/fake-task-stores";
import { createRouterClient } from "@orpc/server";
import type { ComputerAuthHeaders } from "../context";
import { memoryBridgeTokenStore } from "./bridge-test-helpers-stores";
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

export function buildComputerRig() {
	const rows = new Map<string, ComputerRow>();
	const computer: ComputerStore = {
		...memoryPairingCodes([]),
		...memoryComputerRows(rows),
	};
	// S2-T2: the launch-delivery stores heartbeat/ackLaunch read alongside the
	// computer store — empty by default, seeded by the runs router tests.
	const run = createFakeRunStore();
	const task = createFakeTaskStore();
	const bridgeToken = memoryBridgeTokenStore(
		new Map(),
		new Map(),
		() => undefined
	);
	const services = {
		authz: { enabled: false },
		computerReplayGuard: createReplayGuard(),
		stores: { bridgeToken, computer, run, task },
	} as never;
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
	return {
		bridgeToken,
		computer,
		computerClientFor,
		publicClient,
		rows,
		run,
		task,
		userClientFor,
	};
}
