import { createSecretBox } from "@better-agent/agent/crypto/secret-box";
import { createFakeEmbeddingClient } from "@better-agent/agent/testing/fake-embedding-client";
import { createAgentStore } from "@better-agent/db/repositories/agent-store";
import { createBridgeTokenStore } from "@better-agent/db/repositories/bridge-token-store";
import { createMemoryItemStore } from "@better-agent/db/repositories/memory-item-store";
import { createMemoryStore } from "@better-agent/db/repositories/memory-store";
import { agents } from "@better-agent/db/schema/agents";
import { users } from "@better-agent/db/schema/auth";
import { bridgeTokens } from "@better-agent/db/schema/bridge";
import { createTestDb, type TestDb } from "@better-agent/db/testing/test-db";
import { createRouterClient } from "@orpc/server";
import { appRouter } from "./index";

// PGlite-backed harness for the memory router tests: the REAL memory stores run
// against an in-memory Postgres (with pgvector), while agent/token ownership
// lookups use the real stores too. Embeddings go through the deterministic FAKE
// so kNN is stable (identical text → identical vector → distance 0).

const SECRET = "test-secret-at-least-32-chars-long!!";

export type Harness = Awaited<ReturnType<typeof buildHarness>>;

export async function buildHarness() {
	const { db, client } = await createTestDb();
	const secretBox = createSecretBox(SECRET);
	const services = {
		embeddingClient: createFakeEmbeddingClient(),
		stores: {
			memory: createMemoryStore(db),
			memoryItem: createMemoryItemStore(db),
			agent: createAgentStore(db, secretBox),
			bridgeToken: createBridgeTokenStore(db),
		},
	};
	const clientFor = (userId: string) =>
		createRouterClient(appRouter, {
			context: {
				services: services as never,
				authedAgent: null,
				authedUser: { id: userId, email: `${userId}@x.com`, blocked: false },
				clientIp: "127.0.0.1",
				userAgent: null,
			},
		});
	return { db, client, services, clientFor };
}

export async function seedUser(db: TestDb, email: string): Promise<string> {
	const [row] = await db.insert(users).values({ email }).returning();
	return row?.id ?? "";
}

export async function seedAgent(
	db: TestDb,
	userId: string,
	tokenHash: string
): Promise<string> {
	const [row] = await db
		.insert(agents)
		.values({
			name: "Helper",
			description: "A helpful agent",
			systemPrompt: "You are helpful.",
			providerId: "anthropic",
			modelId: "claude-opus-4-5",
			tokenHash,
			userId,
		})
		.returning();
	return row?.id ?? "";
}

export async function seedToken(
	db: TestDb,
	userId: string,
	tokenHash: string
): Promise<string> {
	const [row] = await db
		.insert(bridgeTokens)
		.values({ userId, agentKind: "claude-code", tokenHash })
		.returning();
	return row?.id ?? "";
}
