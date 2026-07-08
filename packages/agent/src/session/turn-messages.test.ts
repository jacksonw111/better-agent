import { expect, it } from "vitest";
import type { AgentConfig } from "../agent/types";
import {
	createFakeMessageStore,
	createFakeModelStore,
	createFakeSessionStore,
	createFakeSummarizer,
} from "../testing/fakes";
import {
	createFakeEmbeddingClient,
	createFakeMemoryItemStore,
	createFakeMemoryStore,
	fakeMemoryItem,
} from "../testing/memory-fakes";
import { buildTurnMessages, persistUserTurn } from "./turn-messages";

function makeAgent(overrides: Partial<AgentConfig> = {}): AgentConfig {
	const now = new Date();
	return {
		id: "agent-1",
		userId: "user-1",
		name: "Agent",
		description: "",
		systemPrompt: "You are a helpful assistant.",
		providerId: "openai",
		modelId: "gpt-4o",
		params: null,
		toolAllowlist: null,
		builtinTools: [],
		mcpServerIds: [],
		composioAccountIds: [],
		createdAt: now,
		updatedAt: now,
		...overrides,
	};
}

function extractSystemPrompt(
	messages: Awaited<ReturnType<typeof buildTurnMessages>>
) {
	const system = messages.find((m) => m.role === "system");
	return typeof system?.content === "string" ? system.content : "";
}

async function setupTurn(text: string) {
	const messageStore = createFakeMessageStore();
	const sessionStore = createFakeSessionStore();
	const session = await sessionStore.create({
		agentId: "agent-1",
		userId: "user-1",
	});
	await persistUserTurn({ messageStore, sessionId: session.id, text });
	return { messageStore, sessionStore, session };
}

it("injects the retrieved memory block when the agent has assigned memories", async () => {
	const { messageStore, sessionStore, session } = await setupTurn(
		"what are my preferences?"
	);
	const item = fakeMemoryItem({ content: "user prefers dark mode" });
	const messages = await buildTurnMessages(
		{
			messageStore,
			sessionStore,
			modelCacheStore: createFakeModelStore(),
			summarizer: createFakeSummarizer(),
			memoryStore: createFakeMemoryStore({
				"agent-1": [{ memoryId: "mem-1", role: "read" }],
			}),
			memoryItemStore: createFakeMemoryItemStore([item]),
			embeddingClient: createFakeEmbeddingClient(),
		},
		makeAgent(),
		session,
		session.id
	);
	const prompt = extractSystemPrompt(messages);
	expect(prompt).toContain("## Relevant memory");
	expect(prompt).toContain("user prefers dark mode");
});

it("leaves the prompt unchanged when the agent has no assigned memories", async () => {
	const { messageStore, sessionStore, session } = await setupTurn("hello");
	const messages = await buildTurnMessages(
		{
			messageStore,
			sessionStore,
			modelCacheStore: createFakeModelStore(),
			summarizer: createFakeSummarizer(),
			memoryStore: createFakeMemoryStore({}),
			memoryItemStore: createFakeMemoryItemStore([]),
			embeddingClient: createFakeEmbeddingClient(),
		},
		makeAgent(),
		session,
		session.id
	);
	const prompt = extractSystemPrompt(messages);
	expect(prompt).not.toContain("Relevant memory");
});

it("leaves the prompt unchanged (and still builds the turn) when memory deps aren't wired at all", async () => {
	const { messageStore, sessionStore, session } = await setupTurn("hello");
	const messages = await buildTurnMessages(
		{
			messageStore,
			sessionStore,
			modelCacheStore: createFakeModelStore(),
			summarizer: createFakeSummarizer(),
		},
		makeAgent(),
		session,
		session.id
	);
	const prompt = extractSystemPrompt(messages);
	expect(prompt).not.toContain("Relevant memory");
	expect(prompt).toContain("You are a helpful assistant.");
});

it("still builds the turn when the embedding provider fails", async () => {
	const { messageStore, sessionStore, session } = await setupTurn(
		"what are my preferences?"
	);
	const messages = await buildTurnMessages(
		{
			messageStore,
			sessionStore,
			modelCacheStore: createFakeModelStore(),
			summarizer: createFakeSummarizer(),
			memoryStore: createFakeMemoryStore({
				"agent-1": [{ memoryId: "mem-1", role: "read" }],
			}),
			memoryItemStore: createFakeMemoryItemStore([fakeMemoryItem()]),
			embeddingClient: createFakeEmbeddingClient({ fails: true }),
		},
		makeAgent(),
		session,
		session.id
	);
	const prompt = extractSystemPrompt(messages);
	expect(prompt).not.toContain("Relevant memory");
	expect(messages.length).toBeGreaterThan(0);
});
