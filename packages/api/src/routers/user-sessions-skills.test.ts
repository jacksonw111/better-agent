import type { LanguageModelV3StreamPart } from "@ai-sdk/provider";
import type { RunEvent } from "@better-agent/agent/session/events";
import { createSessionRuntime } from "@better-agent/agent/session/runtime";
import { createInMemorySessionLock } from "@better-agent/agent/session/session-lock";
import { createFakeAgentStore } from "@better-agent/agent/testing/fake-agent-store";
import { createFakeSkillStore } from "@better-agent/agent/testing/fake-skill-store";
import {
	createFakeCatalogStore,
	createFakeMessageStore,
	createFakeModelStore,
	createFakeSessionStore,
	createFakeSummarizer,
} from "@better-agent/agent/testing/fakes";
import { createInMemoryPendingToolCallStore } from "@better-agent/agent/tool/pending-store";
import { createRouterClient } from "@orpc/server";
import { MockLanguageModelV3, simulateReadableStream } from "ai/test";
import { expect, it } from "vitest";
import { appRouter } from "./index";

const HAPPY: LanguageModelV3StreamPart[] = [
	{ type: "text-start", id: "0" },
	{ type: "text-delta", id: "0", delta: "Hi there" },
	{ type: "text-end", id: "0" },
	{
		type: "finish",
		finishReason: { unified: "stop", raw: "stop" },
		usage: {
			inputTokens: {
				total: 3,
				noCache: undefined,
				cacheRead: undefined,
				cacheWrite: undefined,
			},
			outputTokens: { total: 2, text: undefined, reasoning: undefined },
		},
	},
];

const AGENT_SEED = {
	name: "Helper",
	description: "d",
	systemPrompt: "You are helpful.",
	providerId: "openai",
	modelId: "gpt-x",
	params: null,
	tokenHash: "hash-skills",
	builtinTools: [] as string[],
	composioAccountIds: [] as string[],
	mcpServerIds: [] as string[],
};

const USER_ID_1 = "00000000-0000-0000-0000-000000000001";

function buildSkillServices() {
	const agentStore = createFakeAgentStore();
	const sessionStore = createFakeSessionStore();
	const messageStore = createFakeMessageStore();
	const skillStore = createFakeSkillStore();
	const capturedModel = new MockLanguageModelV3({
		doStream: () =>
			Promise.resolve({ stream: simulateReadableStream({ chunks: HAPPY }) }),
	});
	const runtime = createSessionRuntime({
		sessionStore,
		messageStore,
		agentStore,
		modelFactory: { create: () => Promise.resolve(capturedModel) },
		sessionLock: createInMemorySessionLock(),
		modelCacheStore: createFakeModelStore(),
		providerCatalogStore: createFakeCatalogStore(),
		summarizer: createFakeSummarizer(),
		skillStore,
	});
	const services = {
		authz: { enabled: false },
		runtime,
		pendingToolCallStore: createInMemoryPendingToolCallStore(),
		composio: () => Promise.resolve(null),
		mcp: () => Promise.resolve(null),
		stores: {
			activity: { log: () => Promise.resolve() },
			agent: agentStore,
			session: sessionStore,
			message: messageStore,
			skill: skillStore,
		},
	};
	return { agentStore, skillStore, services, capturedModel };
}

async function seedDeploySkillAgent(
	agentStore: ReturnType<typeof createFakeAgentStore>,
	skillStore: ReturnType<typeof createFakeSkillStore>
) {
	const agent = await agentStore.create(AGENT_SEED);
	const skill = await skillStore.create({
		userId: USER_ID_1,
		name: "deploy",
		description: "Ship a release",
		instructions: "1. Run tests\n2. Ship it",
		allowedTools: ["get_current_time"],
	});
	await skillStore.assignAgent({ agentId: agent.id, skillId: skill.id });
	return agent;
}

it("a /skill-name prompt reaches streamText with the skill's tools folded in", async () => {
	const { agentStore, skillStore, services, capturedModel } =
		buildSkillServices();
	const agent = await seedDeploySkillAgent(agentStore, skillStore);
	const client = createRouterClient(appRouter, {
		context: {
			services: services as never,
			authedAgent: null,
			authedUser: {
				id: USER_ID_1,
				email: "x@y.com",
				createdAt: new Date(),
				blocked: false,
			},
			clientIp: "127.0.0.1",
			userAgent: null,
			waitUntil: () => {
				// no-op in tests
			},
		},
	});
	const session = await client.userSessions.create({ agentId: agent.id });
	const events: RunEvent[] = [];
	for await (const event of await client.userSessions.prompt({
		sessionId: session.id,
		text: "/deploy do the release",
	})) {
		events.push(event);
	}
	expect(events.at(-1)?.type).toBe("done");
	const call = capturedModel.doStreamCalls[0];
	expect((call?.tools ?? []).map((t) => t.name)).toContain("get_current_time");
});
