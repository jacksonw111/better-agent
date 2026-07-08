import { hashToken } from "@better-agent/agent/crypto/auth-tokens";
import { createFakeEmbeddingClient } from "@better-agent/agent/testing/fake-embedding-client";
import { createBridgeTokenStore } from "@better-agent/db/repositories/bridge-token-store";
import { createMemoryItemStore } from "@better-agent/db/repositories/memory-item-store";
import { createMemoryStore } from "@better-agent/db/repositories/memory-store";
import { users } from "@better-agent/db/schema/auth";
import { bridgeTokens } from "@better-agent/db/schema/bridge";
import { createTestDb } from "@better-agent/db/testing/test-db";
import { afterEach, beforeEach, expect, it } from "vitest";
import { buildMemoryMcpApp, MEMORY_MCP_SERVER_INFO } from "./memory-mcp";

// End-to-end tests over the real Hono endpoint: PGlite (real Postgres +
// pgvector) underneath, the REAL memory/bridge-token stores, and the
// deterministic fake embedding client (identical text → identical vector, so
// kNN is stable). Each raw token below is the exact bearer a local agent
// would send; only its hash is persisted.

const HTTP_UNAUTHORIZED = 401;
const embedding = createFakeEmbeddingClient();

interface RpcBody {
	error?: { code: number; message: string };
	result?: {
		content?: { text: string; type: string }[];
		isError?: boolean;
		serverInfo?: unknown;
		tools?: { name: string }[];
	};
}

let ctx: Awaited<ReturnType<typeof createTestDb>>;
let stores: {
	bridgeToken: ReturnType<typeof createBridgeTokenStore>;
	memory: ReturnType<typeof createMemoryStore>;
	memoryItem: ReturnType<typeof createMemoryItemStore>;
};
let app: ReturnType<typeof buildMemoryMcpApp>;
let userId: string;

beforeEach(async () => {
	ctx = await createTestDb();
	stores = {
		bridgeToken: createBridgeTokenStore(ctx.db),
		memory: createMemoryStore(ctx.db),
		memoryItem: createMemoryItemStore(ctx.db),
	};
	app = buildMemoryMcpApp({ embeddingClient: embedding, stores });
	const [user] = await ctx.db
		.insert(users)
		.values({ email: "alice@x.com" })
		.returning();
	userId = user?.id ?? "";
});

afterEach(async () => {
	await ctx.client.close();
});

async function seedToken(raw: string, revoked = false): Promise<string> {
	const [row] = await ctx.db
		.insert(bridgeTokens)
		.values({
			userId,
			agentKind: "claude-code",
			tokenHash: hashToken(raw),
			revokedAt: revoked ? new Date() : null,
		})
		.returning();
	return row?.id ?? "";
}

async function seedMemory(name: string, items: string[] = []): Promise<string> {
	const memory = await stores.memory.create({ userId, name });
	await Promise.all(
		items.map(async (content) =>
			stores.memoryItem.add({
				memoryId: memory.id,
				content,
				embedding: await embedding.embed(content),
				model: embedding.model,
			})
		)
	);
	return memory.id;
}

function rpc(method: string, params?: Record<string, unknown>, token?: string) {
	const headers: Record<string, string> = {
		"content-type": "application/json",
	};
	if (token) {
		headers.authorization = `Bearer ${token}`;
	}
	return app.request("/", {
		method: "POST",
		headers,
		body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
	});
}

async function callTool(
	name: string,
	args: Record<string, unknown>,
	token: string
): Promise<RpcBody> {
	const res = await rpc("tools/call", { name, arguments: args }, token);
	return (await res.json()) as RpcBody;
}

function texts(body: RpcBody): string {
	return (body.result?.content ?? []).map((block) => block.text).join("\n");
}

it("rejects requests without a valid bridge token", async () => {
	await seedToken("bt_revoked", true);
	expect((await rpc("tools/list")).status).toBe(HTTP_UNAUTHORIZED);
	expect((await rpc("tools/list", undefined, "bt_unknown")).status).toBe(
		HTTP_UNAUTHORIZED
	);
	expect((await rpc("tools/list", undefined, "bt_revoked")).status).toBe(
		HTTP_UNAUTHORIZED
	);
});

it("completes initialize and lists the two memory tools", async () => {
	await seedToken("bt_ok");
	const init = (await (await rpc("initialize", {}, "bt_ok")).json()) as RpcBody;
	expect(init.result?.serverInfo).toEqual(MEMORY_MCP_SERVER_INFO);
	const list = (await (
		await rpc("tools/list", undefined, "bt_ok")
	).json()) as RpcBody;
	expect((list.result?.tools ?? []).map((tool) => tool.name)).toEqual([
		"memory_search",
		"memory_add",
	]);
});

it("memory_search returns only items from the token's assigned memories", async () => {
	const tokenId = await seedToken("bt_search");
	const assigned = await seedMemory("Prefs", ["prefers typescript"]);
	// Identical text in an UNASSIGNED memory — must never surface.
	await seedMemory("Other", ["prefers typescript"]);
	await stores.memory.assignToken({
		tokenId,
		memoryId: assigned,
		role: "read",
	});

	const body = await callTool(
		"memory_search",
		{ query: "prefers typescript", k: 10 },
		"bt_search"
	);
	expect(body.result?.isError).toBe(false);
	expect(body.result?.content).toHaveLength(1);
	expect(texts(body)).toContain("[Prefs]");
	expect(texts(body)).toContain("prefers typescript");
});

it("clamps k into range instead of failing", async () => {
	const tokenId = await seedToken("bt_k");
	const memoryId = await seedMemory("Notes", ["fact one", "fact two"]);
	await stores.memory.assignToken({ tokenId, memoryId, role: "read" });

	const huge = await callTool(
		"memory_search",
		{ query: "fact one", k: 999 },
		"bt_k"
	);
	expect(huge.result?.isError).toBe(false);
	expect(huge.result?.content).toHaveLength(2);
	const tiny = await callTool(
		"memory_search",
		{ query: "fact one", k: -3 },
		"bt_k"
	);
	expect(tiny.result?.content).toHaveLength(1);
});

it("memory_add fails without a read_write assignment", async () => {
	const tokenId = await seedToken("bt_ro");
	const memoryId = await seedMemory("Prefs");
	await stores.memory.assignToken({ tokenId, memoryId, role: "read" });

	const body = await callTool("memory_add", { content: "x" }, "bt_ro");
	expect(body.result?.isError).toBe(true);
	expect(texts(body)).toContain("read_write");
});

it("memory_add writes into the single writable memory as source=extracted", async () => {
	const tokenId = await seedToken("bt_rw");
	const readable = await seedMemory("ReadOnly");
	const writable = await seedMemory("Journal");
	await stores.memory.assignToken({
		tokenId,
		memoryId: readable,
		role: "read",
	});
	await stores.memory.assignToken({
		tokenId,
		memoryId: writable,
		role: "read_write",
	});

	const body = await callTool(
		"memory_add",
		{ content: "deploy on fridays", importance: 0.9 },
		"bt_rw"
	);
	expect(body.result?.isError).toBe(false);
	expect(texts(body)).toContain('"Journal"');
	const items = await stores.memoryItem.listCurrent(writable);
	expect(items).toHaveLength(1);
	expect(items[0]?.content).toBe("deploy on fridays");
	expect(items[0]?.source).toBe("extracted");
	expect(await stores.memoryItem.listCurrent(readable)).toHaveLength(0);
});

it("memory_add across several writable memories requires memory_name", async () => {
	const tokenId = await seedToken("bt_multi");
	const alpha = await seedMemory("Alpha");
	const beta = await seedMemory("Beta");
	await stores.memory.assignToken({
		tokenId,
		memoryId: alpha,
		role: "read_write",
	});
	await stores.memory.assignToken({
		tokenId,
		memoryId: beta,
		role: "read_write",
	});

	const ambiguous = await callTool("memory_add", { content: "x" }, "bt_multi");
	expect(ambiguous.result?.isError).toBe(true);
	expect(texts(ambiguous)).toContain("Alpha");
	expect(texts(ambiguous)).toContain("Beta");

	const picked = await callTool(
		"memory_add",
		{ content: "beta fact", memory_name: "Beta" },
		"bt_multi"
	);
	expect(picked.result?.isError).toBe(false);
	expect(await stores.memoryItem.listCurrent(beta)).toHaveLength(1);
	expect(await stores.memoryItem.listCurrent(alpha)).toHaveLength(0);
});
