import { expect, it } from "vitest";
import {
	createFakeEmbeddingClient,
	createFakeMemoryItemStore,
	createFakeMemoryStore,
	fakeMemoryItem,
} from "../testing/memory-fakes";
import { buildMemoryContext, latestUserText } from "./memory-retrieval";
import type { MessageWithParts } from "./types";

function userEntry(text: string): MessageWithParts {
	const now = new Date();
	return {
		message: {
			id: "m1",
			sessionId: "s1",
			role: "user",
			seq: 0,
			status: "complete",
			providerId: null,
			modelId: null,
			usage: null,
			finishReason: null,
			error: null,
			createdAt: now,
			updatedAt: now,
		},
		parts: [
			{
				id: "p1",
				messageId: "m1",
				seq: 0,
				type: "text",
				content: { text },
				status: "complete",
				createdAt: now,
				updatedAt: now,
			},
		],
	};
}

it("latestUserText returns the trimmed text of the last user message", () => {
	expect(latestUserText([userEntry("  hello there  ")])).toBe("hello there");
});

it("latestUserText returns empty string when there is no user message", () => {
	expect(latestUserText([])).toBe("");
});

it("returns a formatted block with the retrieved items when the agent has assigned memories", async () => {
	const item = fakeMemoryItem({ content: "user prefers dark mode" });
	const deps = {
		memoryStore: createFakeMemoryStore({
			"agent-1": [{ memoryId: "mem-1", role: "read" as const }],
		}),
		memoryItemStore: createFakeMemoryItemStore([item]),
		embeddingClient: createFakeEmbeddingClient(),
	};
	const block = await buildMemoryContext(deps, "agent-1", "what do I like?");
	expect(block).toContain("## Relevant memory");
	expect(block).toContain("user prefers dark mode");
});

it("returns null when the agent has no assigned memories (skips the embed call)", async () => {
	let embedCalls = 0;
	const embeddingClient = createFakeEmbeddingClient();
	const countingClient = {
		...embeddingClient,
		embed: (text: string) => {
			embedCalls++;
			return embeddingClient.embed(text);
		},
	};
	const deps = {
		memoryStore: createFakeMemoryStore({}),
		memoryItemStore: createFakeMemoryItemStore([]),
		embeddingClient: countingClient,
	};
	const block = await buildMemoryContext(deps, "agent-1", "anything");
	expect(block).toBeNull();
	expect(embedCalls).toBe(0);
});

it("returns null when no embedding client is configured", async () => {
	const deps = {
		memoryStore: createFakeMemoryStore({
			"agent-1": [{ memoryId: "mem-1", role: "read" as const }],
		}),
		memoryItemStore: createFakeMemoryItemStore([fakeMemoryItem()]),
		embeddingClient: null,
	};
	const block = await buildMemoryContext(deps, "agent-1", "anything");
	expect(block).toBeNull();
});

it("returns null when the query is empty", async () => {
	const deps = {
		memoryStore: createFakeMemoryStore({
			"agent-1": [{ memoryId: "mem-1", role: "read" as const }],
		}),
		memoryItemStore: createFakeMemoryItemStore([fakeMemoryItem()]),
		embeddingClient: createFakeEmbeddingClient(),
	};
	const block = await buildMemoryContext(deps, "agent-1", "   ");
	expect(block).toBeNull();
});

it("returns null (not a thrown error) when the embedding provider fails", async () => {
	const deps = {
		memoryStore: createFakeMemoryStore({
			"agent-1": [{ memoryId: "mem-1", role: "read" as const }],
		}),
		memoryItemStore: createFakeMemoryItemStore([fakeMemoryItem()]),
		embeddingClient: createFakeEmbeddingClient({ fails: true }),
	};
	const block = await buildMemoryContext(deps, "agent-1", "anything");
	expect(block).toBeNull();
});
