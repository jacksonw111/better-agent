import { expect, it } from "vitest";
import type { BundleSkill } from "./bundle";
import { createFakeFs } from "./fake-fs";
import type { SyncRoots } from "./fs-ports";
import { landSkills } from "./skills-land";

const ROOTS: SyncRoots = {
	betterAgentDir: "/home/.better-agent",
	claudeDir: "/home/.claude",
};

function skill(name: string): BundleSkill {
	return { description: `${name} desc`, instructions: `do ${name}`, name };
}

it("writes each skill as skills/<name>/SKILL.md and returns the names", async () => {
	const fs = createFakeFs();
	const names = await landSkills(fs, ROOTS, [skill("deploy")], []);
	expect(names).toEqual(["deploy"]);
	const md = fs.get("/home/.claude/skills/deploy/SKILL.md") ?? "";
	expect(md).toContain("name: deploy");
	expect(md).toContain("do deploy");
});

it("cleans up a previously-managed skill that is now gone", async () => {
	const fs = createFakeFs();
	await landSkills(fs, ROOTS, [skill("a"), skill("b")], []);
	await landSkills(fs, ROOTS, [skill("a")], ["a", "b"]);
	expect(fs.get("/home/.claude/skills/a/SKILL.md")).toBeDefined();
	expect(fs.get("/home/.claude/skills/b/SKILL.md")).toBeUndefined();
});

it("never removes a skill the user placed by hand (not in the manifest)", async () => {
	const fs = createFakeFs({
		"/home/.claude/skills/mine/SKILL.md": "hand-written",
	});
	await landSkills(fs, ROOTS, [skill("a")], []);
	expect(fs.get("/home/.claude/skills/mine/SKILL.md")).toBe("hand-written");
});
