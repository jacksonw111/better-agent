import { log } from "evlog";
import type {
	EmbeddingClient,
	MemoryItemRow,
	MemoryItemStore,
	MemoryStore,
} from "../ports";
import type { MessageWithParts } from "./types";

// B1 retrieval injection: each turn, kNN-search the agent's assigned memories
// against the latest user message and inject the top-k items into the system
// prompt. This is the only path web chat agents have into their assigned
// memories today — the memory MCP server is bridge-token-auth-only, so web
// agents can't call memory tools directly (that gap is a separate, bigger
// follow-up: local/bridge-agent MCP auto-wiring).

const DEFAULT_MEMORY_K = 5;

export interface MemoryRetrievalDeps {
	/** null/undefined when no embedding provider is configured — retrieval is
	 * skipped entirely rather than attempting a doomed embed call. */
	embeddingClient?: EmbeddingClient | null;
	memoryItemStore: MemoryItemStore;
	memoryStore: MemoryStore;
}

/** The most recent user message's text (the current turn, already persisted by
 * the time buildTurnMessages runs) — used as the retrieval query. Empty string
 * if there's no user message or it carries no text parts. */
export function latestUserText(history: MessageWithParts[]): string {
	// Reverse loop rather than Array.findLast — the agent package is compiled
	// by consumers (e.g. web) whose tsconfig lib target predates ES2023.
	let entry: MessageWithParts | undefined;
	for (let i = history.length - 1; i >= 0; i--) {
		const item = history[i];
		if (item?.message.role === "user") {
			entry = item;
			break;
		}
	}
	if (!entry) {
		return "";
	}
	const texts: string[] = [];
	for (const part of entry.parts) {
		if (part.type === "text") {
			texts.push(part.content.text);
		}
	}
	return texts.join("\n").trim();
}

function formatMemoryBlock(items: MemoryItemRow[]): string {
	const lines = items.map((item) => `- ${item.content}`);
	return `## Relevant memory\n${lines.join("\n")}`;
}

/** Returns a compact, clearly-delimited block of the agent's assigned
 * memories most relevant to `query`, or null when there's nothing to inject:
 * no assigned memories (skipped before any embed call — no cost), no
 * embedding client configured, an empty query, or a retrieval/embed failure.
 * A failure here must never break the turn, so every DB/network call is
 * wrapped and logged rather than thrown. */
export async function buildMemoryContext(
	deps: MemoryRetrievalDeps,
	agentId: string,
	query: string,
	k = DEFAULT_MEMORY_K
): Promise<string | null> {
	if (!deps.embeddingClient || query.trim().length === 0) {
		return null;
	}
	try {
		const links = await deps.memoryStore.listAgentMemories(agentId);
		if (links.length === 0) {
			return null;
		}
		const embedding = await deps.embeddingClient.embed(query);
		const items = await deps.memoryItemStore.search({
			embedding,
			memoryIds: links.map((link) => link.memoryId),
			k,
			bumpAccessedAt: true,
		});
		return items.length > 0 ? formatMemoryBlock(items) : null;
	} catch (error) {
		log.error({
			action: "memory-retrieval failed",
			agentId,
			error: error instanceof Error ? error.message : String(error),
		});
		return null;
	}
}
