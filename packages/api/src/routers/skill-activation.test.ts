import type { SkillRow } from "@better-agent/agent/ports";
import { persistUserTurn } from "@better-agent/agent/session/turn-messages";
import { createFakeSkillStore } from "@better-agent/agent/testing/fake-skill-store";
import { createFakeMessageStore } from "@better-agent/agent/testing/fakes";
import { expect, it } from "vitest";
import type { Context } from "../context";
import { resolveActiveSkill } from "./skill-activation";

const AGENT_ID = "agent-1";
const SESSION_ID = "session-1";

function fakeSkill(overrides: Partial<SkillRow> = {}): SkillRow {
	const now = new Date();
	return {
		id: "skill-1",
		userId: "user-1",
		name: "deploy",
		description: "Ship a release",
		instructions: "do the thing",
		allowedTools: null,
		mcpServerIds: null,
		createdAt: now,
		updatedAt: now,
		...overrides,
	};
}

async function buildContext(skills: SkillRow[], priorTexts: string[] = []) {
	const skillStore = createFakeSkillStore(skills);
	for (const skill of skills) {
		await skillStore.assignAgent({ agentId: AGENT_ID, skillId: skill.id });
	}
	const messageStore = createFakeMessageStore();
	for (const text of priorTexts) {
		await persistUserTurn({ messageStore, sessionId: SESSION_ID, text });
	}
	const context = {
		services: { stores: { skill: skillStore, message: messageStore } },
	} as unknown as Context;
	return context;
}

it("returns null when the agent has no assigned skills", async () => {
	const context = await buildContext([]);
	const active = await resolveActiveSkill(
		context,
		AGENT_ID,
		SESSION_ID,
		"/deploy go"
	);
	expect(active).toBeNull();
});

it("activates from the CURRENT (not-yet-persisted) turn's text", async () => {
	const skill = fakeSkill({ name: "deploy" });
	const context = await buildContext([skill]);
	const active = await resolveActiveSkill(
		context,
		AGENT_ID,
		SESSION_ID,
		"/deploy go"
	);
	expect(active?.id).toBe(skill.id);
});

it("stays activated on a later turn that doesn't repeat the directive (sticky)", async () => {
	const skill = fakeSkill({ name: "deploy" });
	const context = await buildContext([skill], ["/deploy step 1"]);
	const active = await resolveActiveSkill(
		context,
		AGENT_ID,
		SESSION_ID,
		"continue please"
	);
	expect(active?.id).toBe(skill.id);
});

it("deactivates after a /clear in prior history", async () => {
	const skill = fakeSkill({ name: "deploy" });
	const context = await buildContext([skill], ["/deploy step 1", "/clear"]);
	const active = await resolveActiveSkill(
		context,
		AGENT_ID,
		SESSION_ID,
		"continue please"
	);
	expect(active).toBeNull();
});
