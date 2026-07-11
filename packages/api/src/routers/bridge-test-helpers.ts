import { createInMemoryRelayStore } from "@better-agent/agent/bridge/relay-store";
import type {
	BridgeAgentKind,
	BridgeMessageRow,
	BridgeMessageStore,
	BridgeSessionRow,
	BridgeSessionStore,
	BridgeTokenRow,
	BridgeTokenStore,
	McpServerRow,
	McpServerStore,
	SkillStore,
} from "@better-agent/agent/ports";
import { createFakeSkillStore } from "@better-agent/agent/testing/fake-skill-store";
import { createFakeUsageRecordStore } from "@better-agent/agent/testing/fake-usage-record-store";
import { createRouterClient } from "@orpc/server";
import { createCommandBus } from "../bridge/command-bus";
import type { AuthedBridgeToken } from "../context";
import { memoryMcpServerStore } from "./bridge-test-helpers-mcp";
import {
	cascadeDeleteSessions,
	memoryBridgeMessageStore,
	memoryBridgeSessionStore,
	memoryBridgeTokenStore,
} from "./bridge-test-helpers-stores";
import { appRouter } from "./index";

// Shared fixtures for the bridge router tests (bridge.test.ts and
// bridge-limits.test.ts), kept in one place so both stay under the
// per-file line cap without duplicating the in-memory store wiring. The
// in-memory store fakes themselves live in bridge-test-helpers-stores.ts /
// bridge-test-helpers-mcp.ts, split out for the same reason.

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

interface TestServices {
	commandBus: ReturnType<typeof createCommandBus>;
	relayStore: ReturnType<typeof createInMemoryRelayStore>;
	stores: {
		bridgeToken: BridgeTokenStore;
		bridgeSession: BridgeSessionStore;
		bridgeMessage: BridgeMessageStore;
		mcpServer: McpServerStore;
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

export function build() {
	const tokenRows = new Map<string, BridgeTokenRow>();
	const tokenHashes = new Map<string, string>();
	const sessionRows = new Map<string, BridgeSessionRow>();
	const messageRowsBySession = new Map<string, BridgeMessageRow[]>();
	const mcpServerRows = new Map<string, McpServerRow>();
	const mcpServerAuthHeaders = new Map<string, string>();
	const bridgeSession = memoryBridgeSessionStore(sessionRows);
	const bridgeMessage = memoryBridgeMessageStore(messageRowsBySession);
	const bridgeToken = memoryBridgeTokenStore(
		tokenRows,
		tokenHashes,
		(tokenId) =>
			cascadeDeleteSessions(sessionRows, messageRowsBySession, tokenId)
	);
	const mcpServer = memoryMcpServerStore(mcpServerRows, mcpServerAuthHeaders);
	const skill = createFakeSkillStore();
	const relayStore = createInMemoryRelayStore();
	const commandBus = createCommandBus();
	const usageRecord = createFakeUsageRecordStore();
	const services: TestServices = {
		commandBus,
		relayStore,
		stores: {
			bridgeToken,
			bridgeSession,
			bridgeMessage,
			mcpServer,
			skill,
			usageRecord,
		},
	};
	const { userClientFor, bridgeClientFor } = createClientFactories(services);
	return {
		bridgeToken,
		bridgeSession,
		bridgeMessage,
		mcpServer,
		skill,
		usageRecord,
		services,
		userClientFor,
		bridgeClientFor,
	};
}
