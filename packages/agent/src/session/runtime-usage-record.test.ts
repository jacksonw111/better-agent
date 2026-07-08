import type {
	LanguageModelV3,
	LanguageModelV3StreamPart,
} from "@ai-sdk/provider";
import { MockLanguageModelV3, simulateReadableStream } from "ai/test";
import { expect, it } from "vitest";
import type { ModelFactory } from "../provider/model-factory";
import { createFakeAgentStore } from "../testing/fake-agent-store";
import { createFakeUsageRecordStore } from "../testing/fake-usage-record-store";
import {
	createFakeCatalogStore,
	createFakeMessageStore,
	createFakeModelStore,
	createFakeSessionStore,
	createFakeSummarizer,
} from "../testing/fakes";
import type { RunEvent } from "./events";
import { createSessionRuntime } from "./runtime";
import { createInMemorySessionLock } from "./session-lock";
import type { Message } from "./types";

const INPUT_TOKENS = 10;
const OUTPUT_TOKENS = 5;
const INPUT_PRICE_PER_M = 3;
const OUTPUT_PRICE_PER_M = 15;
const TOKENS_PER_MILLION = 1_000_000;
const EXPECTED_COST_USD =
	(INPUT_TOKENS * INPUT_PRICE_PER_M + OUTPUT_TOKENS * OUTPUT_PRICE_PER_M) /
	TOKENS_PER_MILLION;

function v3Usage(input: number, output: number) {
	return {
		inputTokens: {
			total: input,
			noCache: undefined,
			cacheRead: undefined,
			cacheWrite: undefined,
		},
		outputTokens: { total: output, text: undefined, reasoning: undefined },
	};
}

const HAPPY: LanguageModelV3StreamPart[] = [
	{ type: "text-start", id: "0" },
	{ type: "text-delta", id: "0", delta: "hi" },
	{ type: "text-end", id: "0" },
	{
		type: "finish",
		finishReason: { unified: "stop", raw: "stop" },
		usage: v3Usage(INPUT_TOKENS, OUTPUT_TOKENS),
	},
];

function happyModel(): LanguageModelV3 {
	return new MockLanguageModelV3({
		doStream: () =>
			Promise.resolve({ stream: simulateReadableStream({ chunks: HAPPY }) }),
	});
}

async function setup(userId: string | null) {
	const agentStore = createFakeAgentStore();
	const sessionStore = createFakeSessionStore();
	const messageStore = createFakeMessageStore();
	const modelCacheStore = createFakeModelStore();
	await modelCacheStore.replaceAll([
		{
			providerId: "openai",
			modelId: "gpt-x",
			name: "GPT X",
			contextLimit: null,
			maxOutputTokens: null,
			inputPricePerM: INPUT_PRICE_PER_M,
			outputPricePerM: OUTPUT_PRICE_PER_M,
			capabilities: { reasoning: false, toolCall: false, vision: false },
		},
	]);
	const usageRecordStore = createFakeUsageRecordStore();
	const agent = await agentStore.create({
		name: "Helper",
		description: "d",
		systemPrompt: "You are helpful.",
		providerId: "openai",
		modelId: "gpt-x",
		params: null,
		composioAccountIds: [],
		mcpServerIds: [],
		builtinTools: [],
		tokenHash: "hash-usage-record",
	});
	const session = await sessionStore.create({ agentId: agent.id, userId });
	const runtime = createSessionRuntime({
		sessionStore,
		messageStore,
		agentStore,
		modelFactory: {
			create: () => Promise.resolve(happyModel()),
		} as ModelFactory,
		sessionLock: createInMemorySessionLock(),
		modelCacheStore,
		providerCatalogStore: createFakeCatalogStore(),
		summarizer: createFakeSummarizer(),
		usageRecordStore,
	});
	return { runtime, session, messageStore, usageRecordStore };
}

async function collect(gen: AsyncGenerator<RunEvent, Message>) {
	let next = await gen.next();
	while (!next.done) {
		next = await gen.next();
	}
	return next.value;
}

it("inserts one usage_records snapshot for a completed turn with a userId", async () => {
	const { runtime, session, messageStore, usageRecordStore } =
		await setup("user-1");
	const final = await collect(
		runtime.runTurn({ sessionId: session.id, text: "hi" })
	);

	expect(usageRecordStore.inserted).toHaveLength(1);
	const [snapshot] = usageRecordStore.inserted;
	expect(snapshot).toMatchObject({
		source: "chat",
		userId: "user-1",
		sessionId: session.id,
		providerId: "openai",
		model: "gpt-x",
		priced: true,
		costUsd: EXPECTED_COST_USD,
		dedupKey: `chat:${final.id}`,
		tokens: {
			input: INPUT_TOKENS,
			output: OUTPUT_TOKENS,
			cacheRead: 0,
			cacheWrite: 0,
			reasoning: 0,
		},
	});

	// No regression: the legacy messages.usage write still happens.
	const assistant = (await messageStore.listWithParts(session.id))[1];
	expect(assistant?.message.usage?.inputTokens).toBe(INPUT_TOKENS);
	expect(assistant?.message.usage?.outputTokens).toBe(OUTPUT_TOKENS);
});

it("skips the usage_records insert when the session has no userId", async () => {
	const { runtime, session, messageStore, usageRecordStore } =
		await setup(null);
	await collect(runtime.runTurn({ sessionId: session.id, text: "hi" }));

	expect(usageRecordStore.inserted).toHaveLength(0);

	// The legacy messages.usage write is unaffected by the userId guard.
	const assistant = (await messageStore.listWithParts(session.id))[1];
	expect(assistant?.message.usage?.inputTokens).toBe(INPUT_TOKENS);
});
