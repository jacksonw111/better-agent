import type { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, expect, it } from "vitest";
import { agents } from "../schema/agents";
import { users } from "../schema/auth";
import { createTestDb, type TestDb } from "../testing/test-db";
import { createSkillStore } from "./skill-store";

let db: TestDb;
let client: PGlite;

beforeEach(async () => {
	({ db, client } = await createTestDb());
});

afterEach(async () => {
	await client.close();
});

async function seedUser(email: string): Promise<string> {
	const [row] = await db.insert(users).values({ email }).returning();
	return row?.id ?? "";
}

async function seedAgent(tokenHash: string): Promise<string> {
	const [row] = await db
		.insert(agents)
		.values({
			name: "Helper",
			description: "A helpful agent",
			systemPrompt: "You are helpful.",
			providerId: "anthropic",
			modelId: "claude-opus-4-5",
			tokenHash,
		})
		.returning();
	return row?.id ?? "";
}

it("create returns a row with id, timestamps and nullable fields", async () => {
	const store = createSkillStore(db);
	const userId = await seedUser("alice@x.com");

	const created = await store.create({ userId, name: "Deploy" });

	expect(created.id).toBeTruthy();
	expect(created.userId).toBe(userId);
	expect(created.name).toBe("Deploy");
	expect(created.description).toBeNull();
	expect(created.instructions).toBeNull();
	expect(created.allowedTools).toBeNull();
	expect(created.mcpServerIds).toBeNull();
	expect(created.createdAt).toBeInstanceOf(Date);
});

it("get returns the created skill and null for a missing id", async () => {
	const store = createSkillStore(db);
	const userId = await seedUser("alice@x.com");
	const created = await store.create({
		userId,
		name: "Deploy",
		description: "Ship the app",
		instructions: "1. build 2. push",
		allowedTools: ["bash"],
		mcpServerIds: ["mcp-1"],
	});

	const got = await store.get(created.id);
	expect(got?.description).toBe("Ship the app");
	expect(got?.instructions).toBe("1. build 2. push");
	expect(got?.allowedTools).toEqual(["bash"]);
	expect(got?.mcpServerIds).toEqual(["mcp-1"]);
	expect(await store.get("00000000-0000-0000-0000-000000000000")).toBeNull();
});

it("getMany batch-fetches, skips missing ids and returns [] for no ids", async () => {
	const store = createSkillStore(db);
	const userId = await seedUser("alice@x.com");
	const a = await store.create({ userId, name: "A" });
	const b = await store.create({ userId, name: "B" });

	const rows = await store.getMany([
		a.id,
		"00000000-0000-0000-0000-000000000000",
		b.id,
	]);
	expect(rows).toHaveLength(2);
	expect(new Set(rows.map((row) => row.name))).toEqual(new Set(["A", "B"]));

	expect(await store.getMany([])).toEqual([]);
});

it("listByUser scopes skills per owner", async () => {
	const store = createSkillStore(db);
	const alice = await seedUser("alice@x.com");
	const bob = await seedUser("bob@x.com");
	await store.create({ userId: alice, name: "A1" });
	await store.create({ userId: alice, name: "A2" });
	await store.create({ userId: bob, name: "B1" });

	const aliceSkills = await store.listByUser(alice);
	expect(aliceSkills).toHaveLength(2);
	expect(aliceSkills.every((row) => row.userId === alice)).toBe(true);
	expect(await store.listByUser(bob)).toHaveLength(1);
});

it("update changes fields and is owner-scoped", async () => {
	const store = createSkillStore(db);
	const alice = await seedUser("alice@x.com");
	const bob = await seedUser("bob@x.com");
	const created = await store.create({ userId: alice, name: "Deploy" });

	const byBob = await store.update(created.id, bob, { name: "Hijacked" });
	expect(byBob).toBeNull();
	expect((await store.get(created.id))?.name).toBe("Deploy");

	const updated = await store.update(created.id, alice, {
		name: "Deploy v2",
		description: "updated desc",
		instructions: "new steps",
		allowedTools: ["git"],
		mcpServerIds: ["mcp-2"],
	});
	expect(updated?.name).toBe("Deploy v2");
	expect(updated?.description).toBe("updated desc");
	expect(updated?.instructions).toBe("new steps");
	expect(updated?.allowedTools).toEqual(["git"]);
	expect(updated?.mcpServerIds).toEqual(["mcp-2"]);
});

it("delete is owner-scoped: another user's delete is a no-op", async () => {
	const store = createSkillStore(db);
	const alice = await seedUser("alice@x.com");
	const bob = await seedUser("bob@x.com");
	const created = await store.create({ userId: alice, name: "A1" });

	await store.delete(created.id, bob);
	expect(await store.get(created.id)).not.toBeNull();

	await store.delete(created.id, alice);
	expect(await store.get(created.id)).toBeNull();
});

it("delete cascades the agent_skills link when owner-scoped", async () => {
	const store = createSkillStore(db);
	const alice = await seedUser("alice@x.com");
	const agentId = await seedAgent("hash-a");
	const created = await store.create({ userId: alice, name: "A1" });
	await store.assignAgent({ agentId, skillId: created.id });

	await store.delete(created.id, alice);

	expect(await store.get(created.id)).toBeNull();
	expect(await store.listAgentSkills(agentId)).toHaveLength(0);
});

it("assignAgent links a skill and is idempotent on re-assign", async () => {
	const store = createSkillStore(db);
	const userId = await seedUser("alice@x.com");
	const agentId = await seedAgent("hash-a");
	const skill = await store.create({ userId, name: "Deploy" });

	await store.assignAgent({ agentId, skillId: skill.id });
	await store.assignAgent({ agentId, skillId: skill.id });

	const linked = await store.listAgentSkills(agentId);
	expect(linked).toHaveLength(1);
	expect(linked[0]?.id).toBe(skill.id);
});

it("unassignAgent removes the link", async () => {
	const store = createSkillStore(db);
	const userId = await seedUser("alice@x.com");
	const agentId = await seedAgent("hash-a");
	const skill = await store.create({ userId, name: "Deploy" });
	await store.assignAgent({ agentId, skillId: skill.id });

	await store.unassignAgent(agentId, skill.id);

	expect(await store.listAgentSkills(agentId)).toHaveLength(0);
});

it("listAgentSkills resolves the assigned skills, scoped per agent, excluding others'", async () => {
	const store = createSkillStore(db);
	const alice = await seedUser("alice@x.com");
	const bob = await seedUser("bob@x.com");
	const agentA = await seedAgent("hash-a");
	const agentB = await seedAgent("hash-b");
	const shared = await store.create({ userId: alice, name: "Shared" });
	const solo = await store.create({ userId: alice, name: "Solo" });
	const bobSkill = await store.create({ userId: bob, name: "Bob's" });
	await store.assignAgent({ agentId: agentA, skillId: shared.id });
	await store.assignAgent({ agentId: agentA, skillId: solo.id });
	await store.assignAgent({ agentId: agentB, skillId: shared.id });

	const aSkills = await store.listAgentSkills(agentA);
	expect(aSkills).toHaveLength(2);
	expect(new Set(aSkills.map((row) => row.name))).toEqual(
		new Set(["Shared", "Solo"])
	);
	expect(aSkills.some((row) => row.id === bobSkill.id)).toBe(false);

	const bSkills = await store.listAgentSkills(agentB);
	expect(bSkills).toHaveLength(1);
	expect(bSkills[0]?.name).toBe("Shared");
});
