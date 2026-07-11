import { expect, it } from "vitest";
import { AGENT_KIND, ALICE, BOB, build } from "./bridge-test-helpers";

// R5-T2: assigning registered skills to a local-agent token — persisted as
// `config.skillIds`, resolved server-side into `ResolvedSkill[]` by both
// startSession and fetchConfig. Mirrors the R5-a MCP-server resolve tests in
// bridge-config.test.ts, split into its own file so neither grows past the
// 300-line cap. The CLI actually writing the resolved skills as `SKILL.md`
// files is R4, already landed.

it("updateTokenConfig persists skillIds the owner can read back", async () => {
	const { userClientFor, skill } = build();
	const alice = userClientFor(ALICE);
	const created1 = await skill.create({
		name: "Alice's skill",
		description: "Does a thing",
		instructions: "Do the thing.",
		userId: ALICE.id,
	});
	const created = await alice.bridge.createToken({ agentKind: AGENT_KIND });

	await alice.bridge.updateTokenConfig({
		config: { skillIds: [created1.id] },
		id: created.id,
	});

	const own = await alice.bridge.getToken({ id: created.id });
	expect(own?.config).toEqual({ skillIds: [created1.id] });
});

it("startSession resolves assigned skillIds into skills with name/description/instructions, excluding another user's skill", async () => {
	const { userClientFor, bridgeClientFor, skill } = build();
	const alice = userClientFor(ALICE);
	const aliceSkill = await skill.create({
		name: "Alice's skill",
		description: "Does a thing",
		instructions: "Do the thing.",
		userId: ALICE.id,
	});
	const bobSkill = await skill.create({
		name: "Bob's skill",
		description: "Does another thing",
		instructions: "Do the other thing.",
		userId: BOB.id,
	});
	const unknownId = crypto.randomUUID();

	const created = await alice.bridge.createToken({ agentKind: AGENT_KIND });
	await alice.bridge.updateTokenConfig({
		config: { skillIds: [aliceSkill.id, bobSkill.id, unknownId] },
		id: created.id,
	});

	const cli = bridgeClientFor({ tokenId: created.id, userId: ALICE.id });
	const started = await cli.bridge.startSession({ agentKind: AGENT_KIND });

	expect(started.skills).toEqual([
		{
			name: "Alice's skill",
			description: "Does a thing",
			instructions: "Do the thing.",
		},
	]);
});

it("fetchConfig resolves assigned skillIds into skills, with empty strings when the skill has no description/instructions", async () => {
	const { userClientFor, bridgeClientFor, skill } = build();
	const alice = userClientFor(ALICE);
	const bare = await skill.create({ name: "Bare skill", userId: ALICE.id });
	const created = await alice.bridge.createToken({ agentKind: AGENT_KIND });
	await alice.bridge.updateTokenConfig({
		config: { skillIds: [bare.id] },
		id: created.id,
	});

	const cli = bridgeClientFor({ tokenId: created.id, userId: ALICE.id });
	const result = await cli.bridge.fetchConfig();

	expect(result.skills).toEqual([
		{ name: "Bare skill", description: "", instructions: "" },
	]);
});

it("fetchConfig/startSession resolve to an empty skills array when no skillIds are assigned", async () => {
	const { userClientFor, bridgeClientFor } = build();
	const alice = userClientFor(ALICE);
	const created = await alice.bridge.createToken({ agentKind: AGENT_KIND });

	const cli = bridgeClientFor({ tokenId: created.id, userId: ALICE.id });
	expect((await cli.bridge.fetchConfig()).skills).toEqual([]);

	const started = await cli.bridge.startSession({ agentKind: AGENT_KIND });
	expect(started.skills).toEqual([]);
});
