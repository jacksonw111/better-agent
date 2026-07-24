import { afterEach, beforeEach, expect, it } from "vitest";
import { createMemoryMcpHarness, texts } from "./memory-mcp-test-support";

// DP2 scope behaviour over the real memory-MCP endpoint: a project session's
// reads/writes are bound to one project via the x-better-agent-project-id
// header. Shared harness lives in memory-mcp-test-support.ts.

let h: Awaited<ReturnType<typeof createMemoryMcpHarness>>;

beforeEach(async () => {
	h = await createMemoryMcpHarness();
});

afterEach(async () => {
	await h.ctx.client.close();
});

// A search returns global memories everywhere, project memories only in their
// own project session, and never another project's.
it("memory_search scopes project memories to the current project", async () => {
	const tokenId = await h.seedToken("bt_scope");
	const projectA = await h.seedProject("alpha");
	const projectB = await h.seedProject("beta");
	const shared = await h.seedMemory("Shared", ["deploy on fridays"]);
	const memA = await h.seedMemory("A-notes", ["uses bun for alpha"], {
		scope: "project",
		projectId: projectA,
	});
	const memB = await h.seedMemory("B-notes", ["uses deno for beta"], {
		scope: "project",
		projectId: projectB,
	});
	for (const memoryId of [shared, memA, memB]) {
		await h.stores.memory.assignToken({ tokenId, memoryId, role: "read" });
	}

	// In project A: global + A visible, B never.
	const inA = await h.callTool(
		"memory_search",
		{ query: "uses", k: 10 },
		"bt_scope",
		projectA
	);
	expect(texts(inA)).toContain("uses bun for alpha");
	expect(texts(inA)).not.toContain("uses deno for beta");
	const sharedInA = await h.callTool(
		"memory_search",
		{ query: "deploy on fridays", k: 10 },
		"bt_scope",
		projectA
	);
	expect(texts(sharedInA)).toContain("deploy on fridays");

	// Stand-alone (no project header): only global surfaces.
	const standalone = await h.callTool(
		"memory_search",
		{ query: "uses", k: 10 },
		"bt_scope"
	);
	expect(texts(standalone)).not.toContain("uses bun for alpha");
	expect(texts(standalone)).not.toContain("uses deno for beta");
});

it("memory_add defaults to the project's memory in a project session", async () => {
	const tokenId = await h.seedToken("bt_addproj");
	const projectA = await h.seedProject("gamma");
	const globalMem = await h.seedMemory("Global");
	const projMem = await h.seedMemory("Gamma", [], {
		scope: "project",
		projectId: projectA,
	});
	await h.stores.memory.assignToken({
		tokenId,
		memoryId: globalMem,
		role: "read_write",
	});
	await h.stores.memory.assignToken({
		tokenId,
		memoryId: projMem,
		role: "read_write",
	});

	const added = await h.callTool(
		"memory_add",
		{ content: "gamma prefers pnpm" },
		"bt_addproj",
		projectA
	);
	expect(added.result?.isError).toBe(false);
	expect(await h.stores.memoryItem.listCurrent(projMem)).toHaveLength(1);
	expect(await h.stores.memoryItem.listCurrent(globalMem)).toHaveLength(0);

	// Explicit scope:"global" overrides the project default.
	const toGlobal = await h.callTool(
		"memory_add",
		{ content: "always run tests", scope: "global" },
		"bt_addproj",
		projectA
	);
	expect(toGlobal.result?.isError).toBe(false);
	expect(await h.stores.memoryItem.listCurrent(globalMem)).toHaveLength(1);
	expect(await h.stores.memoryItem.listCurrent(projMem)).toHaveLength(1);
});

it("memory_add without a project session writes to the global memory", async () => {
	const tokenId = await h.seedToken("bt_addglobal");
	const projectA = await h.seedProject("delta");
	const globalMem = await h.seedMemory("Global");
	const projMem = await h.seedMemory("Delta", [], {
		scope: "project",
		projectId: projectA,
	});
	await h.stores.memory.assignToken({
		tokenId,
		memoryId: globalMem,
		role: "read_write",
	});
	await h.stores.memory.assignToken({
		tokenId,
		memoryId: projMem,
		role: "read_write",
	});

	const added = await h.callTool(
		"memory_add",
		{ content: "no project here" },
		"bt_addglobal"
	);
	expect(added.result?.isError).toBe(false);
	expect(await h.stores.memoryItem.listCurrent(globalMem)).toHaveLength(1);
	expect(await h.stores.memoryItem.listCurrent(projMem)).toHaveLength(0);
});
