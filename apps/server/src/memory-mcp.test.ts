import { afterEach, beforeEach, expect, it } from "vitest";
import { MEMORY_MCP_SERVER_INFO } from "./memory-mcp";
import {
	createMemoryMcpHarness,
	type RpcBody,
	texts,
} from "./memory-mcp-test-support";

// End-to-end tests over the real Hono endpoint — the shared PGlite harness lives
// in memory-mcp-test-support.ts. Scope (DP2) behaviour is covered separately in
// memory-mcp-scope.test.ts. Each raw token below is the exact bearer a local
// agent would send; only its hash is persisted.

const HTTP_UNAUTHORIZED = 401;

let h: Awaited<ReturnType<typeof createMemoryMcpHarness>>;

beforeEach(async () => {
	h = await createMemoryMcpHarness();
});

afterEach(async () => {
	await h.ctx.client.close();
});

it("rejects requests without a valid bridge token", async () => {
	await h.seedToken("bt_revoked", true);
	expect((await h.rpc("tools/list")).status).toBe(HTTP_UNAUTHORIZED);
	expect((await h.rpc("tools/list", undefined, "bt_unknown")).status).toBe(
		HTTP_UNAUTHORIZED
	);
	expect((await h.rpc("tools/list", undefined, "bt_revoked")).status).toBe(
		HTTP_UNAUTHORIZED
	);
});

it("completes initialize and lists the two memory tools", async () => {
	await h.seedToken("bt_ok");
	const init = (await (
		await h.rpc("initialize", {}, "bt_ok")
	).json()) as RpcBody;
	expect(init.result?.serverInfo).toEqual(MEMORY_MCP_SERVER_INFO);
	const list = (await (
		await h.rpc("tools/list", undefined, "bt_ok")
	).json()) as RpcBody;
	expect((list.result?.tools ?? []).map((tool) => tool.name)).toEqual([
		"memory_search",
		"memory_add",
	]);
});

it("memory_search returns only items from the token's assigned memories", async () => {
	const tokenId = await h.seedToken("bt_search");
	const assigned = await h.seedMemory("Prefs", ["prefers typescript"]);
	// Identical text in an UNASSIGNED memory — must never surface.
	await h.seedMemory("Other", ["prefers typescript"]);
	await h.stores.memory.assignToken({
		tokenId,
		memoryId: assigned,
		role: "read",
	});

	const body = await h.callTool(
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
	const tokenId = await h.seedToken("bt_k");
	const memoryId = await h.seedMemory("Notes", ["fact one", "fact two"]);
	await h.stores.memory.assignToken({ tokenId, memoryId, role: "read" });

	const huge = await h.callTool(
		"memory_search",
		{ query: "fact one", k: 999 },
		"bt_k"
	);
	expect(huge.result?.isError).toBe(false);
	expect(huge.result?.content).toHaveLength(2);
	const tiny = await h.callTool(
		"memory_search",
		{ query: "fact one", k: -3 },
		"bt_k"
	);
	expect(tiny.result?.content).toHaveLength(1);
});

it("memory_add fails without a read_write assignment", async () => {
	const tokenId = await h.seedToken("bt_ro");
	const memoryId = await h.seedMemory("Prefs");
	await h.stores.memory.assignToken({ tokenId, memoryId, role: "read" });

	const body = await h.callTool("memory_add", { content: "x" }, "bt_ro");
	expect(body.result?.isError).toBe(true);
	expect(texts(body)).toContain("read_write");
});

it("memory_add writes into the single writable memory as source=extracted", async () => {
	const tokenId = await h.seedToken("bt_rw");
	const readable = await h.seedMemory("ReadOnly");
	const writable = await h.seedMemory("Journal");
	await h.stores.memory.assignToken({
		tokenId,
		memoryId: readable,
		role: "read",
	});
	await h.stores.memory.assignToken({
		tokenId,
		memoryId: writable,
		role: "read_write",
	});

	const body = await h.callTool(
		"memory_add",
		{ content: "deploy on fridays", importance: 0.9 },
		"bt_rw"
	);
	expect(body.result?.isError).toBe(false);
	expect(texts(body)).toContain('"Journal"');
	const items = await h.stores.memoryItem.listCurrent(writable);
	expect(items).toHaveLength(1);
	expect(items[0]?.content).toBe("deploy on fridays");
	expect(items[0]?.source).toBe("extracted");
	expect(await h.stores.memoryItem.listCurrent(readable)).toHaveLength(0);
});

it("memory_add across several writable memories requires memory_name", async () => {
	const tokenId = await h.seedToken("bt_multi");
	const alpha = await h.seedMemory("Alpha");
	const beta = await h.seedMemory("Beta");
	await h.stores.memory.assignToken({
		tokenId,
		memoryId: alpha,
		role: "read_write",
	});
	await h.stores.memory.assignToken({
		tokenId,
		memoryId: beta,
		role: "read_write",
	});

	const ambiguous = await h.callTool(
		"memory_add",
		{ content: "x" },
		"bt_multi"
	);
	expect(ambiguous.result?.isError).toBe(true);
	expect(texts(ambiguous)).toContain("Alpha");
	expect(texts(ambiguous)).toContain("Beta");

	const picked = await h.callTool(
		"memory_add",
		{ content: "beta fact", memory_name: "Beta" },
		"bt_multi"
	);
	expect(picked.result?.isError).toBe(false);
	expect(await h.stores.memoryItem.listCurrent(beta)).toHaveLength(1);
	expect(await h.stores.memoryItem.listCurrent(alpha)).toHaveLength(0);
});
