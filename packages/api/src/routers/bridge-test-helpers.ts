import { createInMemoryRelayStore } from "@better-agent/agent/bridge/relay-store";
import type {
	BridgeAgentKind,
	BridgeSessionRow,
	BridgeSessionStore,
	BridgeTokenRow,
	BridgeTokenStore,
	McpServerRow,
	McpServerStore,
	PushPayload,
	PushService,
	SkillStore,
} from "@better-agent/agent/ports";
import {
	createFakePushSubscriptionStore,
	type FakePushSubscriptionStore,
} from "@better-agent/agent/testing/fake-push-subscription-store";
import { createFakeSkillStore } from "@better-agent/agent/testing/fake-skill-store";
import { createFakeRunStore } from "@better-agent/agent/testing/fake-task-stores";
import { createFakeUsageRecordStore } from "@better-agent/agent/testing/fake-usage-record-store";
import { createRouterClient } from "@orpc/server";
import type { AuthedBridgeToken } from "../context";
import {
	type MemoryAttachmentStore,
	memoryAttachmentStore,
} from "./bridge-test-helpers-attachments";
import { memoryMcpServerStore } from "./bridge-test-helpers-mcp";
import {
	cascadeDeleteSessions,
	memoryBridgeSessionStore,
	memoryBridgeTokenStore,
} from "./bridge-test-helpers-stores";
import { appRouter } from "./index";

// Shared fixtures for the bridge router tests (bridge.test.ts), kept in one
// place so tests stay under the per-file line cap without duplicating the
// in-memory store wiring. The in-memory store fakes themselves live in
// bridge-test-helpers-stores.ts / bridge-test-helpers-mcp.ts, split out for
// the same reason.

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

/** One push a test's capturing PushSender received. */
export interface CapturedPush {
	payload: PushPayload;
	userId: string;
}

/** P3-T3: a PushService whose sender just records what it was asked to send
 * (`sends`). Tests flip `services.push = null` to exercise the
 * disabled-without-VAPID-keys path. */
function capturingPushService(sends: CapturedPush[]): PushService {
	return {
		vapidPublicKey: "test-vapid-public-key",
		sender: {
			sendToUser(userId, payload) {
				sends.push({ userId, payload });
				return Promise.resolve();
			},
		},
	};
}

interface TestServices {
	push: PushService | null;
	relayStore: ReturnType<typeof createInMemoryRelayStore>;
	stores: {
		attachment: MemoryAttachmentStore;
		bridgeToken: BridgeTokenStore;
		bridgeSession: BridgeSessionStore;
		mcpServer: McpServerStore;
		pushSubscription: FakePushSubscriptionStore;
		/** S2-T2: startSession's optional runId binds against this store. */
		run: ReturnType<typeof createFakeRunStore>;
		skill: SkillStore;
		usageRecord: ReturnType<typeof createFakeUsageRecordStore>;
	};
}

/** The two oRPC router-client factories `build()` returns, split out so
 * `build()` itself stays under the 50-line function cap. */
function createClientFactories(services: TestServices) {
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
	return { userClientFor, bridgeClientFor };
}

/** The map-backed bridge store fakes, split out of `build()` to keep it
 * under the 50-line function cap. */
function buildMemoryBridgeStores() {
	const tokenRows = new Map<string, BridgeTokenRow>();
	const tokenHashes = new Map<string, string>();
	const sessionRows = new Map<string, BridgeSessionRow>();
	const mcpServerRows = new Map<string, McpServerRow>();
	const mcpServerAuthHeaders = new Map<string, string>();
	return {
		bridgeSession: memoryBridgeSessionStore(sessionRows),
		bridgeToken: memoryBridgeTokenStore(tokenRows, tokenHashes, (tokenId) =>
			cascadeDeleteSessions(sessionRows, tokenId)
		),
		mcpServer: memoryMcpServerStore(mcpServerRows, mcpServerAuthHeaders),
	};
}

export function build() {
	const { bridgeSession, bridgeToken, mcpServer } = buildMemoryBridgeStores();
	const skill = createFakeSkillStore();
	const relayStore = createInMemoryRelayStore();
	const usageRecord = createFakeUsageRecordStore();
	const attachment = memoryAttachmentStore();
	const pushSubscription = createFakePushSubscriptionStore();
	const run = createFakeRunStore();
	const pushSends: CapturedPush[] = [];
	const services: TestServices = {
		push: capturingPushService(pushSends),
		relayStore,
		stores: {
			attachment,
			bridgeToken,
			bridgeSession,
			mcpServer,
			pushSubscription,
			run,
			skill,
			usageRecord,
		},
	};
	const { userClientFor, bridgeClientFor } = createClientFactories(services);
	return {
		attachment,
		bridgeToken,
		bridgeSession,
		mcpServer,
		pushSends,
		pushSubscription,
		run,
		skill,
		usageRecord,
		services,
		userClientFor,
		bridgeClientFor,
	};
}
