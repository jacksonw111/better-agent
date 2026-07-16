import { expect, it } from "vitest";
import type { SkillRow } from "../ports";
import {
	collectUserTexts,
	findActiveSkill,
	findActiveSkillName,
} from "./skill-activation";
import type { MessageWithParts } from "./types";

function userEntry(text: string): MessageWithParts {
	const now = new Date();
	return {
		message: {
			id: crypto.randomUUID(),
			sessionId: "s1",
			role: "user",
			seq: 0,
			status: "complete",
			providerId: null,
			modelId: null,
			usage: null,
			finishReason: null,
			error: null,
			createdAt: now,
			updatedAt: now,
		},
		parts: [
			{
				id: crypto.randomUUID(),
				messageId: "m1",
				seq: 0,
				type: "text",
				content: { text },
				status: "complete",
				createdAt: now,
				updatedAt: now,
			},
		],
	};
}

function fakeSkill(overrides: Partial<SkillRow> = {}): SkillRow {
	const now = new Date();
	return {
		id: crypto.randomUUID(),
		userId: "user-1",
		isBuiltin: false,
		name: "deploy",
		description: "Ship a release",
		instructions: "1. Run tests\n2. Tag\n3. Push",
		allowedTools: null,
		mcpServerIds: null,
		createdAt: now,
		updatedAt: now,
		...overrides,
	};
}

it("collectUserTexts returns only user messages' joined text, in order", () => {
	const assistantEntry: MessageWithParts = {
		...userEntry("ignored"),
		message: { ...userEntry("x").message, role: "assistant" },
	};
	const history: MessageWithParts[] = [
		userEntry("first"),
		assistantEntry,
		userEntry("second"),
	];
	expect(collectUserTexts(history)).toEqual(["first", "second"]);
});

it("findActiveSkillName returns null when no directive is present", () => {
	const skills = [fakeSkill()];
	expect(findActiveSkillName(["hello there"], skills)).toBeNull();
});

it("findActiveSkillName matches a `/name` directive at the start of a message", () => {
	const skills = [fakeSkill({ name: "deploy" })];
	expect(findActiveSkillName(["/deploy do the release"], skills)).toBe(
		"deploy"
	);
});

it("findActiveSkillName ignores an unknown `/foo` directive (no activation)", () => {
	const skills = [fakeSkill({ name: "deploy" })];
	expect(findActiveSkillName(["/foo do something"], skills)).toBeNull();
});

it("findActiveSkillName returns the LATEST matching directive across messages", () => {
	const skills = [fakeSkill({ name: "deploy" }), fakeSkill({ name: "review" })];
	expect(
		findActiveSkillName(["/deploy step 1", "continue", "/review this"], skills)
	).toBe("review");
});

it("a later `/clear` deactivates (supersedes an earlier activation)", () => {
	const skills = [fakeSkill({ name: "deploy" })];
	expect(
		findActiveSkillName(["/deploy step 1", "/clear", "ok now what"], skills)
	).toBeNull();
});

it("an unrecognized slash command after activation does not clear it", () => {
	const skills = [fakeSkill({ name: "deploy" })];
	expect(
		findActiveSkillName(["/deploy step 1", "/unknown-thing", "next"], skills)
	).toBe("deploy");
});

it("findActiveSkill resolves the full SkillRow for the active directive", () => {
	const skill = fakeSkill({ name: "deploy" });
	expect(findActiveSkill(["/deploy go"], [skill])).toEqual(skill);
});

it("findActiveSkill returns null when nothing is active", () => {
	expect(findActiveSkill(["hi"], [fakeSkill()])).toBeNull();
});
