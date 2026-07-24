import { hashToken } from "@better-agent/agent/crypto/auth-tokens";
import { createFakeEmbeddingClient } from "@better-agent/agent/testing/fake-embedding-client";
import { createBridgeTokenStore } from "@better-agent/db/repositories/bridge-token-store";
import { createMemoryItemStore } from "@better-agent/db/repositories/memory-item-store";
import { createMemoryStore } from "@better-agent/db/repositories/memory-store";
import { createProjectStore } from "@better-agent/db/repositories/project-store";
import { users } from "@better-agent/db/schema/auth";
import { bridgeTokens } from "@better-agent/db/schema/bridge";
import { computers } from "@better-agent/db/schema/computers";
import { projects } from "@better-agent/db/schema/projects";
import { createTestDb } from "@better-agent/db/testing/test-db";
import type { Hono } from "hono";
import { buildMemoryMcpApp } from "./memory-mcp";

// Shared harness for the memory-MCP end-to-end tests (memory-mcp.test.ts +
// memory-mcp-scope.test.ts): PGlite (real Postgres + pgvector), the REAL
// memory/bridge-token/project stores, and the deterministic fake embedding
// client (identical text → identical vector, so kNN is stable). Split into its
// own file, with the seed/rpc helpers as free functions, so both test files
// and every function stay under the per-file / per-function caps.

export const embedding = createFakeEmbeddingClient();

type Ctx = Awaited<ReturnType<typeof createTestDb>>;
type Stores = {
	bridgeToken: ReturnType<typeof createBridgeTokenStore>;
	memory: ReturnType<typeof createMemoryStore>;
	memoryItem: ReturnType<typeof createMemoryItemStore>;
	project: ReturnType<typeof createProjectStore>;
};

interface ScopeSeed {
	projectId: string;
	scope: "global" | "project";
}

export interface RpcBody {
	error?: { code: number; message: string };
	result?: {
		content?: { text: string; type: string }[];
		isError?: boolean;
		serverInfo?: unknown;
		tools?: { name: string }[];
	};
}

async function seedToken(
	ctx: Ctx,
	userId: string,
	raw: string,
	revoked: boolean
): Promise<string> {
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

async function seedMemory(
	stores: Stores,
	userId: string,
	name: string,
	items: string[],
	scope?: ScopeSeed
): Promise<string> {
	const memory = await stores.memory.create({
		userId,
		name,
		scope: scope?.scope,
		projectId: scope?.projectId,
	});
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

// A project needs a Computer (FK); both are the caller's so the memory-MCP
// project header validates. Returns the project id used as the session scope.
async function seedProject(
	ctx: Ctx,
	userId: string,
	name: string
): Promise<string> {
	const [computer] = await ctx.db
		.insert(computers)
		.values({ userId, name: `${name}-box`, publicKeyPem: "pk" })
		.returning();
	const [project] = await ctx.db
		.insert(projects)
		.values({
			userId,
			computerId: computer?.id ?? "",
			name,
			repoFullName: `acme/${name}`,
			repoCloneUrl: `https://example.com/${name}.git`,
		})
		.returning();
	return project?.id ?? "";
}

function rpc(
	app: Hono,
	method: string,
	params?: Record<string, unknown>,
	token?: string,
	projectId?: string
) {
	const headers: Record<string, string> = {
		"content-type": "application/json",
	};
	if (token) {
		headers.authorization = `Bearer ${token}`;
	}
	if (projectId) {
		headers["x-better-agent-project-id"] = projectId;
	}
	return app.request("/", {
		method: "POST",
		headers,
		body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
	});
}

async function callTool(
	app: Hono,
	name: string,
	args: Record<string, unknown>,
	token: string,
	projectId?: string
): Promise<RpcBody> {
	const res = await rpc(
		app,
		"tools/call",
		{ name, arguments: args },
		token,
		projectId
	);
	return (await res.json()) as RpcBody;
}

/** A fresh MCP app over an isolated PGlite db, with bound seed/rpc helpers. */
export async function createMemoryMcpHarness() {
	const ctx = await createTestDb();
	const stores: Stores = {
		bridgeToken: createBridgeTokenStore(ctx.db),
		memory: createMemoryStore(ctx.db),
		memoryItem: createMemoryItemStore(ctx.db),
		project: createProjectStore(ctx.db),
	};
	const app = buildMemoryMcpApp({ embeddingClient: embedding, stores });
	const [user] = await ctx.db
		.insert(users)
		.values({ email: "alice@x.com" })
		.returning();
	const userId = user?.id ?? "";
	return {
		ctx,
		stores,
		app,
		userId,
		seedToken: (raw: string, revoked = false) =>
			seedToken(ctx, userId, raw, revoked),
		seedMemory: (name: string, items: string[] = [], scope?: ScopeSeed) =>
			seedMemory(stores, userId, name, items, scope),
		seedProject: (name: string) => seedProject(ctx, userId, name),
		rpc: (
			method: string,
			params?: Record<string, unknown>,
			token?: string,
			projectId?: string
		) => rpc(app, method, params, token, projectId),
		callTool: (
			name: string,
			args: Record<string, unknown>,
			token: string,
			projectId?: string
		) => callTool(app, name, args, token, projectId),
	};
}

export function texts(body: RpcBody): string {
	return (body.result?.content ?? []).map((block) => block.text).join("\n");
}
