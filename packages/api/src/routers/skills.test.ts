import type { AgentStore, McpServerRow } from "@better-agent/agent/ports";
import { createFakeAgentStore } from "@better-agent/agent/testing/fake-agent-store";
import { createFakeSkillStore } from "@better-agent/agent/testing/fake-skill-store";
import { createRouterClient } from "@orpc/server";
import { expect, it } from "vitest";
import { appRouter } from "./index";

const ALICE = {
	id: "alice-uid",
	email: "alice@x.com",
	createdAt: new Date(),
	blocked: false,
};
const BOB = {
	id: "bob-uid",
	email: "bob@x.com",
	createdAt: new Date(),
	blocked: false,
};

interface Stores {
	agent: AgentStore;
	mcpServer: { listByUser: (userId: string) => Promise<McpServerRow[]> };
	skill: ReturnType<typeof createFakeSkillStore>;
}

function buildClient(authedUser: typeof ALICE, stores: Stores) {
	const services = {
		authz: { enabled: false },
		authConfig: { adminEmails: [] as string[] },
		stores,
	};
	return createRouterClient(appRouter, {
		context: {
			services: services as never,
			waitUntil: () => {
				// no background work in tests
			},
			authedAgent: null,
			authedUser,
			clientIp: "127.0.0.1",
			userAgent: null,
		},
	});
}

function mcpServerRow(id: string, userId: string): McpServerRow {
	return {
		id,
		userId,
		name: "svc",
		url: "https://mcp.example.test",
		authLast4: null,
		createdAt: new Date(),
	};
}

function freshStores(mcpServers: McpServerRow[] = []): Stores {
	return {
		agent: createFakeAgentStore(),
		skill: createFakeSkillStore(),
		mcpServer: {
			listByUser: (userId: string) =>
				Promise.resolve(mcpServers.filter((row) => row.userId === userId)),
		},
	};
}

const SKILL_INPUT = {
	name: "Deploy",
	description: "Deploys the app",
	instructions: "Run the deploy script",
};

const AGENT_INPUT = {
	name: "Helper",
	description: "d",
	systemPrompt: "s",
	providerId: "openai",
	modelId: "gpt-x",
	params: null,
	composioAccountIds: [] as string[],
	mcpServerIds: [] as string[],
	toolAllowlist: null,
	builtinTools: [] as string[],
};

it("create/list/get round-trips a skill scoped to the owner", async () => {
	const alice = buildClient(ALICE, freshStores());

	const created = await alice.skills.create(SKILL_INPUT);
	expect(created.userId).toBe(ALICE.id);

	const list = await alice.skills.list();
	expect(list).toHaveLength(1);

	const fetched = await alice.skills.get({ skillId: created.id });
	expect(fetched.name).toBe("Deploy");
});

it("update changes fields for the owner only", async () => {
	const stores = freshStores();
	const alice = buildClient(ALICE, stores);
	const skill = await alice.skills.create(SKILL_INPUT);

	const updated = await alice.skills.update({
		skillId: skill.id,
		name: "Deploy v2",
	});
	expect(updated.name).toBe("Deploy v2");
	expect(updated.description).toBe(SKILL_INPUT.description);
});

it("rejects get/update/delete from a non-owner", async () => {
	const stores = freshStores();
	const alice = buildClient(ALICE, stores);
	const bob = buildClient(BOB, stores);
	const skill = await alice.skills.create(SKILL_INPUT);

	await expect(bob.skills.get({ skillId: skill.id })).rejects.toThrow();
	await expect(
		bob.skills.update({ skillId: skill.id, name: "Hijacked" })
	).rejects.toThrow();
	await expect(bob.skills.delete({ skillId: skill.id })).rejects.toThrow();

	// Alice's skill survives every rejected attempt.
	const survivor = await alice.skills.get({ skillId: skill.id });
	expect(survivor.name).toBe("Deploy");
});

it("delete removes the skill for its owner", async () => {
	const stores = freshStores();
	const alice = buildClient(ALICE, stores);
	const skill = await alice.skills.create(SKILL_INPUT);

	await alice.skills.delete({ skillId: skill.id });

	expect(await alice.skills.list()).toHaveLength(0);
	await expect(alice.skills.get({ skillId: skill.id })).rejects.toThrow();
});

it("assigns a skill to an agent and lists it via listAssigned", async () => {
	const stores = freshStores();
	const alice = buildClient(ALICE, stores);
	const skill = await alice.skills.create(SKILL_INPUT);
	const agent = await stores.agent.create({
		...AGENT_INPUT,
		tokenHash: "hash-a",
		userId: ALICE.id,
	});

	await alice.skills.assignAgent({ agentId: agent.id, skillId: skill.id });
	const assigned = await alice.skills.listAssigned({ agentId: agent.id });
	expect(assigned).toHaveLength(1);
	expect(assigned[0]?.id).toBe(skill.id);

	await alice.skills.unassignAgent({ agentId: agent.id, skillId: skill.id });
	expect(await alice.skills.listAssigned({ agentId: agent.id })).toHaveLength(
		0
	);
});

it("rejects assign when the caller doesn't own the agent", async () => {
	const stores = freshStores();
	const alice = buildClient(ALICE, stores);
	const skill = await alice.skills.create(SKILL_INPUT);
	const bobAgent = await stores.agent.create({
		...AGENT_INPUT,
		tokenHash: "hash-b",
		userId: BOB.id,
	});

	await expect(
		alice.skills.assignAgent({ agentId: bobAgent.id, skillId: skill.id })
	).rejects.toThrow();
	await expect(
		alice.skills.listAssigned({ agentId: bobAgent.id })
	).rejects.toThrow();
});

it("rejects assign when the caller doesn't own the skill", async () => {
	const stores = freshStores();
	const alice = buildClient(ALICE, stores);
	const bob = buildClient(BOB, stores);
	const bobSkill = await bob.skills.create(SKILL_INPUT);
	const aliceAgent = await stores.agent.create({
		...AGENT_INPUT,
		tokenHash: "hash-a",
		userId: ALICE.id,
	});

	await expect(
		alice.skills.assignAgent({ agentId: aliceAgent.id, skillId: bobSkill.id })
	).rejects.toThrow();
});

it("exposes built-ins read-only: listable, assignable, but not editable", async () => {
	const stores = freshStores();
	stores.skill.upsertBuiltin({
		name: "market-review",
		description: "A股复盘",
		instructions: "复盘流程",
		allowedTools: ["finance_market_breadth"],
	});
	const alice = buildClient(ALICE, stores);
	const [builtin] = await alice.skills.list();
	expect(builtin?.isBuiltin).toBe(true);

	// Readable + assignable to the caller's own agent.
	const fetched = await alice.skills.get({ skillId: builtin?.id ?? "" });
	expect(fetched.name).toBe("market-review");
	const agent = await stores.agent.create({
		...AGENT_INPUT,
		tokenHash: "hash-a",
		userId: ALICE.id,
	});
	await alice.skills.assignAgent({
		agentId: agent.id,
		skillId: builtin?.id ?? "",
	});
	expect(await alice.skills.listAssigned({ agentId: agent.id })).toHaveLength(
		1
	);

	// But never editable or deletable through the owner-scoped router.
	await expect(
		alice.skills.update({ skillId: builtin?.id ?? "", name: "hacked" })
	).rejects.toThrow();
	await expect(
		alice.skills.delete({ skillId: builtin?.id ?? "" })
	).rejects.toThrow();
});

const OWNED_MCP_ID = "11111111-1111-4111-8111-111111111111";
const FOREIGN_MCP_ID = "22222222-2222-4222-8222-222222222222";

// Regression coverage for the cross-user MCP exposure bug: a foreign
// mcpServerId (Bob's server) put into Alice's skill must never be persisted —
// otherwise assigning the skill to Alice's own agent would let Alice's agent
// run Bob's MCP server with Bob's stored auth header on activation.
it("drops an mcpServerId the caller does not own on create, keeps an owned one", async () => {
	const stores = freshStores([
		mcpServerRow(OWNED_MCP_ID, ALICE.id),
		mcpServerRow(FOREIGN_MCP_ID, BOB.id),
	]);
	const alice = buildClient(ALICE, stores);

	const created = await alice.skills.create({
		...SKILL_INPUT,
		mcpServerIds: [OWNED_MCP_ID, FOREIGN_MCP_ID],
	});
	expect(created.mcpServerIds).toEqual([OWNED_MCP_ID]);
});

it("drops an mcpServerId the caller does not own on update, keeps an owned one", async () => {
	const stores = freshStores([
		mcpServerRow(OWNED_MCP_ID, ALICE.id),
		mcpServerRow(FOREIGN_MCP_ID, BOB.id),
	]);
	const alice = buildClient(ALICE, stores);
	const skill = await alice.skills.create(SKILL_INPUT);

	const updated = await alice.skills.update({
		skillId: skill.id,
		mcpServerIds: [OWNED_MCP_ID, FOREIGN_MCP_ID],
	});
	expect(updated.mcpServerIds).toEqual([OWNED_MCP_ID]);
});

it("leaves mcpServerIds untouched when an update omits the field", async () => {
	const stores = freshStores([mcpServerRow(OWNED_MCP_ID, ALICE.id)]);
	const alice = buildClient(ALICE, stores);
	const skill = await alice.skills.create({
		...SKILL_INPUT,
		mcpServerIds: [OWNED_MCP_ID],
	});

	const updated = await alice.skills.update({
		skillId: skill.id,
		name: "Deploy v2",
	});
	expect(updated.mcpServerIds).toEqual([OWNED_MCP_ID]);
});
