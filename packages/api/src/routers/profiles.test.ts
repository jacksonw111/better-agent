import { createSecretBox } from "@better-agent/agent/crypto/secret-box";
import { createAgentStore } from "@better-agent/db/repositories/agent-store";
import { createMcpServerStore } from "@better-agent/db/repositories/mcp-server-store";
import { createProfileStore } from "@better-agent/db/repositories/profile-store";
import { createSkillStore } from "@better-agent/db/repositories/skill-store";
import { users } from "@better-agent/db/schema/auth";
import { createTestDb, type TestDb } from "@better-agent/db/testing/test-db";
import { createRouterClient } from "@orpc/server";
import { afterEach, beforeEach, expect, it } from "vitest";
import { appRouter } from "./index";

const SECRET = "test-secret-at-least-32-chars-long!!";

let db: TestDb;
let close: () => Promise<void>;

// PGlite-backed harness: the REAL profile/skill/mcp stores run against an
// in-memory Postgres, so version linkage (a skill or MCP change bumping the
// profile version) is exercised end-to-end rather than mocked.
function buildHarness() {
	const secretBox = createSecretBox(SECRET);
	const services = {
		authz: { enabled: false },
		mcp: () =>
			Promise.resolve({
				execute: () => Promise.resolve({ output: "" }),
				listTools: () => Promise.resolve([{ description: "", name: "T" }]),
			}),
		stores: {
			activity: { log: () => Promise.resolve() },
			agent: createAgentStore(db, secretBox),
			mcpServer: createMcpServerStore(db, secretBox),
			profile: createProfileStore(db),
			skill: createSkillStore(db),
		},
	};
	const clientFor = (userId: string) =>
		createRouterClient(appRouter, {
			context: {
				authedAgent: null,
				authedUser: { blocked: false, email: `${userId}@x.com`, id: userId },
				clientIp: "127.0.0.1",
				services: services as never,
				userAgent: null,
			},
		});
	// A bridge-token-authed client — how the sync CLI reaches
	// `profiles.materializeBundle` (bridgeProcedure, not a web JWT).
	const bridgeClientFor = (userId: string) =>
		createRouterClient(appRouter, {
			context: {
				authedAgent: null,
				authedBridgeToken: { tokenId: `bt-${userId}`, userId },
				authedUser: null,
				clientIp: "127.0.0.1",
				services: services as never,
				userAgent: null,
			},
		});
	return { bridgeClientFor, clientFor };
}

async function seedUser(email: string): Promise<string> {
	const [row] = await db.insert(users).values({ email }).returning();
	return row?.id ?? "";
}

beforeEach(async () => {
	const { db: testDb, client } = await createTestDb();
	db = testDb;
	close = () => client.close();
});

afterEach(async () => {
	await close();
});

it("get lazily creates the profile at version 1 with empty relations", async () => {
	const { clientFor } = buildHarness();
	const alice = clientFor(await seedUser("alice@x.com"));

	const profile = await alice.profiles.get();
	expect(profile.version).toBe(1);
	expect(profile.standards).toEqual([]);
	expect(profile.templates).toEqual([]);
});

it("standards create/update/delete round-trip and each write bumps the version", async () => {
	const { clientFor } = buildHarness();
	const alice = clientFor(await seedUser("alice@x.com"));

	const created = await alice.profiles.standards.create({
		body: "Remove console.log.",
		title: "No logs",
	});
	expect((await alice.profiles.get()).version).toBe(2); // +1 on create

	const updated = await alice.profiles.standards.update({
		standardId: created.id,
		title: "No logs v2",
	});
	expect(updated.title).toBe("No logs v2");
	expect((await alice.profiles.get()).version).toBe(3); // +1 on update

	await alice.profiles.standards.delete({ standardId: created.id });
	expect((await alice.profiles.get()).version).toBe(4); // +1 on delete
	expect((await alice.profiles.get()).standards).toEqual([]);
});

it("reorder rewrites order and bumps the version", async () => {
	const { clientFor } = buildHarness();
	const alice = clientFor(await seedUser("alice@x.com"));
	const a = await alice.profiles.standards.create({ body: "a", title: "A" });
	const b = await alice.profiles.standards.create({ body: "b", title: "B" });

	await alice.profiles.standards.reorder({ orderedIds: [b.id, a.id] });

	const profile = await alice.profiles.get();
	expect(profile.standards.map((s) => s.title)).toEqual(["B", "A"]);
	expect(profile.version).toBe(4); // 2 creates + 1 reorder
});

it("templates create/update/delete round-trip and bump the version", async () => {
	const { clientFor } = buildHarness();
	const alice = clientFor(await seedUser("alice@x.com"));

	const created = await alice.profiles.templates.create({ name: "Node" });
	expect(created.scaffold).toEqual({ dirs: [], files: [] });
	expect((await alice.profiles.get()).version).toBe(2);

	const updated = await alice.profiles.templates.update({
		claudeMd: "Use pnpm.",
		templateId: created.id,
	});
	expect(updated.claudeMd).toBe("Use pnpm.");
	expect((await alice.profiles.get()).version).toBe(3);

	await alice.profiles.templates.delete({ templateId: created.id });
	expect((await alice.profiles.get()).templates).toEqual([]);
	expect((await alice.profiles.get()).version).toBe(4);
});

it("a template drops an mcpServerId the caller does not own", async () => {
	const { clientFor } = buildHarness();
	const alice = clientFor(await seedUser("alice@x.com"));
	const bob = clientFor(await seedUser("bob@x.com"));
	const owned = await alice.mcp.createServer({
		name: "mine",
		url: "https://mcp.example.test",
	});
	const foreign = await bob.mcp.createServer({
		name: "theirs",
		url: "https://mcp.example.test",
	});

	const template = await alice.profiles.templates.create({
		mcpServerIds: [owned.id, foreign.id],
		name: "T",
	});
	expect(template.mcpServerIds).toEqual([owned.id]);
});

it("profiles are per-owner: a non-owner cannot touch another's standard", async () => {
	const { clientFor } = buildHarness();
	const alice = clientFor(await seedUser("alice@x.com"));
	const bob = clientFor(await seedUser("bob@x.com"));
	const std = await alice.profiles.standards.create({ body: "a", title: "A" });

	await expect(
		bob.profiles.standards.update({ standardId: std.id, title: "hack" })
	).rejects.toThrow();

	// Bob's own profile never sees Alice's standard.
	expect((await bob.profiles.get()).standards).toEqual([]);
	expect((await alice.profiles.get()).standards[0]?.title).toBe("A");
});

it("creating a skill bumps the profile version", async () => {
	const { clientFor } = buildHarness();
	const alice = clientFor(await seedUser("alice@x.com"));
	expect((await alice.profiles.get()).version).toBe(1);

	await alice.skills.create({
		description: "Ships it",
		instructions: "run deploy",
		name: "Deploy",
	});

	expect((await alice.profiles.get()).version).toBe(2);
});

it("adding an MCP server bumps the profile version", async () => {
	const { clientFor } = buildHarness();
	const alice = clientFor(await seedUser("alice@x.com"));
	expect((await alice.profiles.get()).version).toBe(1);

	await alice.mcp.createServer({
		name: "X",
		url: "https://mcp.example.test",
	});

	expect((await alice.profiles.get()).version).toBe(2);
});

it("materializeBundle returns version + standards + skills + mcp + templates", async () => {
	const { clientFor, bridgeClientFor } = buildHarness();
	const userId = await seedUser("alice@x.com");
	const alice = clientFor(userId);
	const aliceBridge = bridgeClientFor(userId);

	await alice.profiles.standards.create({
		body: "Remove console.log.",
		title: "No logs",
	});
	await alice.skills.create({
		description: "Ships it",
		instructions: "run deploy",
		name: "Deploy",
	});
	await alice.mcp.createServer({
		name: "Weather",
		url: "https://mcp.example.test",
	});
	await alice.profiles.templates.create({
		claudeMd: "Use pnpm.",
		name: "Node",
	});

	const bundle = await aliceBridge.profiles.materializeBundle();
	expect(bundle.version).toBeGreaterThan(1);
	expect(bundle.standards).toEqual([
		{
			body: "Remove console.log.",
			enabled: true,
			sortOrder: 0,
			title: "No logs",
		},
	]);
	expect(bundle.skills).toContainEqual({
		description: "Ships it",
		instructions: "run deploy",
		name: "Deploy",
	});
	expect(bundle.mcpServers).toContainEqual(
		expect.objectContaining({
			headers: {},
			name: "Weather",
			url: "https://mcp.example.test",
		})
	);
	expect(bundle.templates).toContainEqual(
		expect.objectContaining({ claudeMd: "Use pnpm.", name: "Node" })
	);
});

it("materializeBundle is owner-scoped: only the token owner's rows appear", async () => {
	const { clientFor, bridgeClientFor } = buildHarness();
	const aliceId = await seedUser("alice@x.com");
	const bobId = await seedUser("bob@x.com");
	await clientFor(aliceId).mcp.createServer({
		name: "AliceOnly",
		url: "https://mcp.example.test",
	});

	const bobBundle = await bridgeClientFor(bobId).profiles.materializeBundle();
	expect(bobBundle.mcpServers.map((server) => server.name)).not.toContain(
		"AliceOnly"
	);
});
