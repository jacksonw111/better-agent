import { describe, expect, it, vi } from "vitest";
import {
	resolveSkillReferences,
	type SkillReferenceDeps,
} from "./skill-references";

// S25-T1 (design D6, master spec §6.6/§10.2): `/name` tokens in the Task
// Description resolve against the local claude-code skill inventory (the same
// discovery detect-inventory uses: ~/.claude/skills/<entry>/SKILL.md with an
// optional frontmatter `name` override). A matched reference inlines the
// SKILL.md body (frontmatter stripped) IN PLACE; unknown `/text` stays
// verbatim; no skills directory means no resolution at all.

const SKILLS_DIR = "/home/tester/.claude/skills";

const RESEARCH_SKILL = `---
name: research
description: "Deep research workflow"
---
# Research skill

Gather sources, verify claims, cite everything.`;

const DEPLOY_SKILL = `---
name: ship-it
description: deploy
---
Run the deploy checklist.`;

function fakeDeps(
	files: Record<string, string> = {
		deploy: DEPLOY_SKILL,
		research: RESEARCH_SKILL,
	}
): SkillReferenceDeps {
	return {
		readDirNames: vi.fn((dir: string) => {
			expect(dir).toBe(SKILLS_DIR);
			return Promise.resolve(Object.keys(files));
		}),
		readTextFile: (path: string) => {
			for (const [entry, content] of Object.entries(files)) {
				if (path === `${SKILLS_DIR}/${entry}/SKILL.md`) {
					return Promise.resolve(content);
				}
			}
			return Promise.reject(new Error(`ENOENT: ${path}`));
		},
		skillsDir: SKILLS_DIR,
	};
}

describe("resolveSkillReferences - matches", () => {
	it("inlines the SKILL.md body (frontmatter stripped) at the reference position", async () => {
		const resolved = await resolveSkillReferences(
			"Please /research the rust ecosystem today.",
			fakeDeps()
		);
		expect(resolved).toBe(
			"Please # Research skill\n\nGather sources, verify claims, cite everything. the rust ecosystem today."
		);
	});

	it("matches the frontmatter name over the directory entry name", async () => {
		const resolved = await resolveSkillReferences("/ship-it now", fakeDeps());
		expect(resolved).toBe("Run the deploy checklist. now");
	});

	it("expands multiple references, each in its own position", async () => {
		const resolved = await resolveSkillReferences(
			"/ship-it then /ship-it again",
			fakeDeps()
		);
		expect(resolved).toBe(
			"Run the deploy checklist. then Run the deploy checklist. again"
		);
	});
});

describe("resolveSkillReferences - non-matches", () => {
	it("keeps an unknown /text verbatim", async () => {
		const description = "Try /unknown-skill and tell me what happens";
		expect(await resolveSkillReferences(description, fakeDeps())).toBe(
			description
		);
	});

	it("does not treat a URL path segment as a reference", async () => {
		const description = "Read https://example.com/research for context";
		expect(await resolveSkillReferences(description, fakeDeps())).toBe(
			description
		);
	});

	it("returns the description unchanged when there is no skills directory", async () => {
		const deps: SkillReferenceDeps = {
			readDirNames: () => Promise.reject(new Error("ENOENT")),
			readTextFile: () => Promise.reject(new Error("ENOENT")),
			skillsDir: SKILLS_DIR,
		};
		expect(await resolveSkillReferences("/research this", deps)).toBe(
			"/research this"
		);
	});

	it("never touches the filesystem when the description has no tokens", async () => {
		const deps = fakeDeps();
		await resolveSkillReferences("plain description, no slash", deps);
		expect(deps.readDirNames).not.toHaveBeenCalled();
	});
});
