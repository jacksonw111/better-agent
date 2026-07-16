import { expect, it } from "vitest";
import type { AgentConfig } from "../agent/types";
import type { SkillRow } from "../ports";
import { createFakeSkillStore } from "../testing/fake-skill-store";
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

function fakeSkill(overrides: Partial<SkillRow> = {}): SkillRow {
	const now = new Date();
	return {
		id: crypto.randomUUID(),
		userId: "user-1",
		isBuiltin: false,
		name: "deploy",
		description: "Ship a release",
		instructions: "1. Run tests\n2. Tag\n3. Push",
		allowedTools: null,
		mcpServerIds: null,
		createdAt: now,
		updatedAt: now,
		...overrides,
	};
}

/** A SkillStore fake with `skills` assigned to `agentId` (the fake tracks
 * assignments separately from the seed rows, mirroring the real store). */
async function skillStoreFor(agentId: string, skills: SkillRow[]) {
	const store = createFakeSkillStore(skills);
	for (const skill of skills) {
		await store.assignAgent({ agentId, skillId: skill.id });
	}
	return store;
}

/** Persists `texts` as successive user turns, then builds the system prompt
 * for the agent's next turn with `skills` assigned. */
async function skillTurnPrompt(
	texts: string[],
	skills: SkillRow[]
): Promise<string> {
	const messageStore = createFakeMessageStore();
	const sessionStore = createFakeSessionStore();
	const session = await sessionStore.create({
		agentId: "agent-1",
		userId: "user-1",
	});
	for (const text of texts) {
		await persistUserTurn({ messageStore, sessionId: session.id, text });
	}
	const messages = await buildTurnMessages(
		{
			messageStore,
			sessionStore,
			modelCacheStore: createFakeModelStore(),
			summarizer: createFakeSummarizer(),
			skillStore: await skillStoreFor("agent-1", skills),
		},
		makeAgent(),
		session,
		session.id
	);
	return extractSystemPrompt(messages);
}

it("injects the skill index when the agent has assigned skills", async () => {
	const skill = fakeSkill({ name: "deploy", description: "Ship a release" });
	const prompt = await skillTurnPrompt(["hi"], [skill]);
	expect(prompt).toContain("## Available skills");
	expect(prompt).toContain("deploy: Ship a release");
	expect(prompt).toContain("/deploy");
	expect(prompt).not.toContain("Active skill");
});

it("leaves the prompt unchanged when the agent has no assigned skills", async () => {
	const prompt = await skillTurnPrompt(["hi"], []);
	expect(prompt).not.toContain("Available skills");
});

it("injects the active skill's full instructions when the user invokes /skill-name", async () => {
	const skill = fakeSkill({
		name: "deploy",
		instructions: "1. Run tests\n2. Tag\n3. Push",
	});
	const prompt = await skillTurnPrompt(["/deploy do X"], [skill]);
	expect(prompt).toContain("## Active skill: deploy");
	expect(prompt).toContain("1. Run tests\n2. Tag\n3. Push");
});

it("does not activate a skill for plain text with no /skill-name directive", async () => {
	const skill = fakeSkill({ name: "deploy" });
	const prompt = await skillTurnPrompt(["just chatting"], [skill]);
	expect(prompt).toContain("## Available skills");
	expect(prompt).not.toContain("Active skill");
});

it("does not activate on an unknown /foo directive", async () => {
	const skill = fakeSkill({ name: "deploy" });
	const prompt = await skillTurnPrompt(["/foo do something"], [skill]);
	expect(prompt).not.toContain("Active skill");
});

it("a later /clear deactivates a previously-activated skill", async () => {
	const skill = fakeSkill({ name: "deploy" });
	const prompt = await skillTurnPrompt(["/deploy step 1", "/clear"], [skill]);
	expect(prompt).toContain("## Available skills");
	expect(prompt).not.toContain("Active skill");
});

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
