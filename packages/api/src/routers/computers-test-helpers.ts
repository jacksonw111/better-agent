import { createInMemoryRelayStore } from "@better-agent/agent/bridge/relay-store";
import type {
	ComputerRow,
	ComputerStore,
} from "@better-agent/agent/computer-ports";
import {
	createReplayGuard,
	signComputerRequest,
} from "@better-agent/agent/crypto/computer-signature";
import { createSecretBox } from "@better-agent/agent/crypto/secret-box";
import type {
	GithubClient,
	GithubIssueDetail,
	GithubRepositorySummary,
} from "@better-agent/agent/github/github-ports";
import type { BridgeSessionRow } from "@better-agent/agent/ports";
import { createFakeActiveSessionStore } from "@better-agent/agent/testing/fake-active-session-store";
import { createFakeProjectStore } from "@better-agent/agent/testing/fake-project-store";
import {
	createFakeRunStore,
	createFakeTaskStore,
} from "@better-agent/agent/testing/fake-task-stores";
import { createRouterClient } from "@orpc/server";
import { createComputerControlChannel } from "../computers/control-channel";
import type { AuthedBridgeToken, ComputerAuthHeaders } from "../context";
import {
	memoryBridgeSessionStore,
	memoryBridgeTokenStore,
} from "./bridge-test-helpers-stores";
import { memoryConnectionStore } from "./github-test-helpers";
import { appRouter } from "./index";
import { buildPtyRig } from "./pty-rig-helpers";

// Shared fixtures for the computers router tests — in-memory stores + clients.

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

/** A signed computer-auth header triple; pass a timestamp for window/replay. */
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

/** Seedable fake GitHub for the rig (S4-T2, §19.6): repos by fullName, issues
 * by `fullName#number`; `failingIssues` keys make getIssue throw, else null. */
function buildFakeGithub() {
	const repositories = new Map<string, GithubRepositorySummary>();
	const issues = new Map<string, GithubIssueDetail>();
	const failingIssues = new Set<string>();
	const issueKey = (fullName: string, issueNumber: number) =>
		`${fullName}#${issueNumber}`;
	const client: GithubClient = {
		verifyToken: () => Promise.resolve({ login: "octocat" }),
		searchRepositories: () => Promise.resolve([...repositories.values()]),
		getRepositoryByFullName: (fullName) =>
			Promise.resolve(repositories.get(fullName) ?? null),
		searchIssues: () => Promise.resolve([]),
		getIssue: (fullName, issueNumber) => {
			const key = issueKey(fullName, issueNumber);
			if (failingIssues.has(key)) {
				return Promise.reject(new Error("GitHub is unreachable"));
			}
			return Promise.resolve(issues.get(key) ?? null);
		},
	};
	return { client, failingIssues, issueKey, issues, repositories };
}

/** S4-T2: GitHub context at Task Start, behind the real connection-store gate. */
function buildGithubRig() {
	return {
		github: buildFakeGithub(),
		githubConnection: memoryConnectionStore(),
		secretBox: createSecretBox("computers-rig-secret-32-chars-min"),
	};
}

/** S2-T2/S2-T3: launch-delivery stores read alongside the computer store. */
function buildDeliveryStores() {
	return {
		bridgeToken: memoryBridgeTokenStore(new Map(), new Map(), () => undefined),
		project: createFakeProjectStore(),
		run: createFakeRunStore(),
		task: createFakeTaskStore(),
	};
}

/** The in-memory stores one rig shares with its returned test handles. */
function buildRigStores() {
	const rows = new Map<string, ComputerRow>();
	const computer: ComputerStore = {
		...memoryPairingCodes([]),
		...memoryComputerRows(rows),
	};
	// S25-T2: lets flow tests drive bridge.startSession(runId) in the SAME rig.
	const bridgeSessionRows = new Map<string, BridgeSessionRow>();
	const bridgeSession = memoryBridgeSessionStore(bridgeSessionRows);
	const delivery = buildDeliveryStores();
	return {
		...buildGithubRig(),
		...delivery,
		activeSession: createFakeActiveSessionStore({
			bridgeSession,
			computer,
			project: delivery.project,
			run: delivery.run,
			task: delivery.task,
		}),
		bridgeSession,
		bridgeSessionRows,
		computer,
		relayStore: createInMemoryRelayStore(),
		rows,
	};
}

function buildRigServices(options: RigOptions = {}) {
	const stores = buildRigStores();
	const {
		activeSession,
		bridgeSession,
		bridgeToken,
		computer,
		github,
		githubConnection,
		project,
		relayStore,
		run,
		secretBox,
		task,
	} = stores;
	const { ptySession, ptyRelay, ptyKills } = buildPtyRig();
	// Real channel, no sockets by default — delivery falls back to heartbeat
	// pendingCommands like a no-WS production computer (D4).
	const computerControl = createComputerControlChannel(
		{ bridgeToken, computer, project, run, secretBox, task },
		{ projectQueryTimeoutMs: options.projectQueryTimeoutMs }
	);
	const services = {
		authz: { enabled: false },
		computerControl,
		computerReplayGuard: createReplayGuard(),
		githubClient: () => github.client,
		ptyRelay,
		relayStore,
		secretBox,
		stores: {
			activeSession,
			bridgeSession,
			bridgeToken,
			computer,
			githubConnection,
			project,
			ptySession,
			run,
			task,
		},
	} as never;
	return { ...stores, computerControl, ptyKills, services };
}

/** Q2: lets query tests shrink the park timeout. */
export interface RigOptions {
	projectQueryTimeoutMs?: number;
}

export function buildComputerRig(options: RigOptions = {}) {
	const { services, ...stores } = buildRigServices(options);
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
	// S25-T2: the CLI plane — a bridge-token client for flow tests.
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
